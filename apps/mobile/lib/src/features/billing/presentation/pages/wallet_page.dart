import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/billing/purchase_service.dart';
import '../../../account/presentation/widgets/account_required_panel.dart';
import '../../data/billing_api_client.dart';

class WalletPage extends StatefulWidget {
  const WalletPage({
    this.client,
    this.purchaseService,
    this.platform,
    this.transactionIdFactory,
    super.key,
  });

  final BillingApiClient? client;
  final PurchaseService? purchaseService;
  final TargetPlatform? platform;
  final String Function()? transactionIdFactory;

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  late final BillingApiClient _client = widget.client ??
      BillingApiClient(baseUrl: AppConfig.fromEnvironment().apiBaseUrl);
  late final PurchaseService _purchaseService = widget.purchaseService ??
      (widget.transactionIdFactory == null
          ? const PlatformPurchaseService()
          : SandboxPurchaseService(
              transactionIdFactory: widget.transactionIdFactory!,
            ));
  late final List<String> _paymentStack =
      AppConfig.fromEnvironment().region.paymentStack;
  TargetPlatform get _platform => widget.platform ?? defaultTargetPlatform;
  late Future<_WalletData> _future = _load();
  String? _busyProductId;
  bool _restoring = false;
  String? _message;

  @override
  void dispose() {
    if (widget.client == null) _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.walletTitle)),
      body: SafeArea(
        child: FutureBuilder<_WalletData>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return _buildLoadError(snapshot.error);
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final data = snapshot.requireData;
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: <Widget>[
                  _BalanceCard(balance: data.balance),
                  if (_message != null) ...<Widget>[
                    const SizedBox(height: 12),
                    Text(_message!),
                  ],
                  const SizedBox(height: 20),
                  Text(l10n.planProduct,
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  for (final product in data.products)
                    _ProductTile(
                      product: product,
                      busy: _busyProductId == product.productId,
                      onPurchase: _paymentProviderFor(product) == null
                          ? null
                          : () => _purchase(product),
                    ),
                  if (_canUseAppleIap) ...<Widget>[
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        onPressed: _restoring ? null : _restorePurchases,
                        icon: _restoring
                            ? const SizedBox.square(
                                dimension: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.restore),
                        label: Text(l10n.restorePurchases),
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  Text(l10n.billingLedger,
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  if (data.ledger.isEmpty)
                    Text(l10n.noBillingLedger)
                  else
                    for (final entry in data.ledger.take(5))
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(entry.note ?? entry.type),
                        subtitle: Text(entry.createdAt.toLocal().toString()),
                        trailing: Text(_formatDelta(entry.deltaSeconds)),
                      ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Future<_WalletData> _load() async {
    final results = await Future.wait<Object>([
      _client.fetchBalance(),
      _client.fetchProducts(),
      _client.fetchLedger(),
    ]);
    return _WalletData(
      balance: results[0] as UsageBalance,
      products: results[1] as List<BillingProduct>,
      ledger: results[2] as List<BillingLedgerEntry>,
    );
  }

  Future<void> _refresh() async {
    setState(() {
      _future = _load();
    });
    try {
      await _future;
    } catch (_) {
      // FutureBuilder renders the actionable error state.
    }
  }

  Future<void> _purchase(BillingProduct product) async {
    final l10n = context.l10n;
    final provider = _paymentProviderFor(product);
    if (provider == null) {
      setState(() => _message = l10n.paymentUnavailable);
      return;
    }
    setState(() {
      _busyProductId = product.productId;
      _message = null;
    });
    try {
      final order = await _client.createOrder(
        productId: product.productId,
        provider: provider,
      );
      final purchase = await _purchaseService.purchase(product.productId);
      if (!purchase.completed) throw PurchaseServiceException(purchase.status);
      await _client.confirmOrder(
        orderId: order.id,
        transactionId: purchase.transactionId!,
        signedTransactionInfo: purchase.signedTransactionInfo,
      );
      await _purchaseService.finishTransaction(purchase.transactionId!);
      setState(() {
        _message = l10n.purchaseSuccess;
        _future = _load();
      });
    } on Object catch (error) {
      setState(() {
        _message = isAccountAuthRequiredError(error)
            ? '请先登录账号后再购买分钟包'
            : l10n.purchaseFailed;
      });
    } finally {
      if (mounted) setState(() => _busyProductId = null);
    }
  }

  Future<void> _restorePurchases() async {
    final l10n = context.l10n;
    setState(() {
      _restoring = true;
      _message = null;
    });
    try {
      final purchases = await _purchaseService.restorePurchases();
      var restored = 0;
      for (final purchase in purchases.where(_canRestorePurchase)) {
        final order = await _client.createOrder(
          productId: purchase.productId!,
          provider: 'apple_iap',
        );
        await _client.confirmOrder(
          orderId: order.id,
          transactionId: purchase.transactionId!,
          signedTransactionInfo: purchase.signedTransactionInfo,
        );
        await _purchaseService.finishTransaction(purchase.transactionId!);
        restored += 1;
      }
      setState(() {
        _message = restored == 0 ? l10n.restoreEmpty : l10n.restoreSuccess;
        _future = _load();
      });
    } on Object catch (error) {
      setState(() {
        _message = isAccountAuthRequiredError(error)
            ? '请先登录账号后再恢复购买'
            : l10n.restoreFailed;
      });
    } finally {
      if (mounted) setState(() => _restoring = false);
    }
  }

  bool _canRestorePurchase(PurchaseResult purchase) {
    return purchase.completed && purchase.productId != null;
  }

  String _formatDelta(int seconds) {
    final minutes = (seconds.abs() / 60).round();
    return seconds >= 0 ? '+$minutes 分钟' : '-$minutes 分钟';
  }

  String? _paymentProviderFor(BillingProduct product) {
    if (_canUseAppleIap && product.providers.contains('apple_iap')) {
      return 'apple_iap';
    }
    return null;
  }

  bool get _canUseAppleIap {
    return _platform == TargetPlatform.iOS &&
        _paymentStack.contains('apple_iap');
  }

  Widget _buildLoadError(Object? error) {
    if (isAccountAuthRequiredError(error)) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: <Widget>[
          AccountRequiredPanel(
            message: '钱包、余额和账单需要登录后查看。',
            onReturn: () {
              if (!mounted) return;
              setState(() => _future = _load());
            },
          ),
        ],
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: <Widget>[
        Text(
          context.l10n.errorMessage(error ?? 'wallet_load_failed'),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: () => setState(() => _future = _load()),
            icon: const Icon(Icons.refresh),
            label: const Text('重试'),
          ),
        ),
      ],
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.balance});

  final UsageBalance balance;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return ListTile(
      leading: const Icon(Icons.account_balance_wallet_outlined),
      title: Text('${l10n.usageBalance}: ${balance.remainingSeconds ~/ 60} 分钟'),
      subtitle: Text('${l10n.planProduct}: ${balance.planCode}'),
      contentPadding: EdgeInsets.zero,
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({
    required this.product,
    required this.busy,
    required this.onPurchase,
  });

  final BillingProduct product;
  final bool busy;
  final VoidCallback? onPurchase;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final price = product.priceCny == 0 ? 'Free' : '¥${product.priceCny}';
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(product.displayName),
      subtitle: Text('${product.description}\n$price'),
      trailing: busy
          ? const SizedBox.square(
              dimension: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : FilledButton(
              onPressed: onPurchase,
              child: Text(onPurchase == null
                  ? l10n.paymentUnavailable
                  : l10n.purchaseSandbox),
            ),
    );
  }
}

class _WalletData {
  const _WalletData({
    required this.balance,
    required this.products,
    required this.ledger,
  });

  final UsageBalance balance;
  final List<BillingProduct> products;
  final List<BillingLedgerEntry> ledger;
}
