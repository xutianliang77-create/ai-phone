package com.example.translation_mobile

import android.content.Intent
import java.util.Calendar
import java.util.TimeZone

data class EnterpriseMediaProjectionControl(
    val shareId: String,
    val generation: Int,
    val publisherIdentity: String,
    val leaseExpiresAtMillis: Long,
    val controlNonce: String
) {
    fun matches(other: EnterpriseMediaProjectionControl): Boolean =
        shareId == other.shareId &&
            generation == other.generation &&
            publisherIdentity == other.publisherIdentity &&
            controlNonce == other.controlNonce

    fun isValid(nowMillis: Long = System.currentTimeMillis()): Boolean =
        UUID_PATTERN.matches(shareId) &&
            UUID_PATTERN.matches(controlNonce) &&
            generation > 0 &&
            publisherIdentity == "ent-share:$shareId:g$generation" &&
            leaseExpiresAtMillis > nowMillis &&
            leaseExpiresAtMillis <= nowMillis + MAX_LEASE_MILLIS

    fun putInto(intent: Intent): Intent = intent
        .putExtra(EXTRA_SHARE_ID, shareId)
        .putExtra(EXTRA_GENERATION, generation)
        .putExtra(EXTRA_PUBLISHER_IDENTITY, publisherIdentity)
        .putExtra(EXTRA_LEASE_EXPIRES_AT, leaseExpiresAtMillis)
        .putExtra(EXTRA_CONTROL_NONCE, controlNonce)

    companion object {
        private const val MAX_LEASE_MILLIS = 5 * 60 * 1000L
        private const val EXTRA_SHARE_ID = "enterprise.shareId"
        private const val EXTRA_GENERATION = "enterprise.generation"
        private const val EXTRA_PUBLISHER_IDENTITY = "enterprise.publisherIdentity"
        private const val EXTRA_LEASE_EXPIRES_AT = "enterprise.leaseExpiresAt"
        private const val EXTRA_CONTROL_NONCE = "enterprise.controlNonce"
        private val UUID_PATTERN = Regex(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-" +
                "[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
        )
        private val ISO_PATTERN = Regex(
            "^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})" +
                "(?:\\.(\\d{1,6}))?Z$"
        )

        fun fromArguments(arguments: Any?): EnterpriseMediaProjectionControl? {
            val values = arguments as? Map<*, *> ?: return null
            val leaseText = values["leaseExpiresAt"] as? String ?: return null
            return EnterpriseMediaProjectionControl(
                shareId = values["shareId"] as? String ?: return null,
                generation = values["generation"] as? Int ?: return null,
                publisherIdentity = values["publisherIdentity"] as? String ?: return null,
                leaseExpiresAtMillis = parseUtcMillis(leaseText) ?: return null,
                controlNonce = values["controlNonce"] as? String ?: return null
            ).takeIf { it.isValid() }
        }

        fun identityFromArguments(arguments: Any?): Triple<String, Int, String>? {
            val values = arguments as? Map<*, *> ?: return null
            val shareId = values["shareId"] as? String ?: return null
            val generation = values["generation"] as? Int ?: return null
            val nonce = values["controlNonce"] as? String ?: return null
            if (!UUID_PATTERN.matches(shareId) ||
                generation < 1 ||
                !UUID_PATTERN.matches(nonce)
            ) return null
            return Triple(shareId, generation, nonce)
        }

        fun fromIntent(intent: Intent): EnterpriseMediaProjectionControl? {
            val shareId = intent.getStringExtra(EXTRA_SHARE_ID) ?: return null
            val publisherIdentity =
                intent.getStringExtra(EXTRA_PUBLISHER_IDENTITY) ?: return null
            val controlNonce = intent.getStringExtra(EXTRA_CONTROL_NONCE) ?: return null
            return EnterpriseMediaProjectionControl(
                shareId = shareId,
                generation = intent.getIntExtra(EXTRA_GENERATION, 0),
                publisherIdentity = publisherIdentity,
                leaseExpiresAtMillis = intent.getLongExtra(EXTRA_LEASE_EXPIRES_AT, 0),
                controlNonce = controlNonce
            ).takeIf { it.isValid() }
        }

        private fun parseUtcMillis(value: String): Long? {
            val match = ISO_PATTERN.matchEntire(value) ?: return null
            val parts = match.groupValues
            val fraction = parts[7].padEnd(3, '0').take(3)
            return runCatching {
                Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
                    isLenient = false
                    clear()
                    set(
                        parts[1].toInt(),
                        parts[2].toInt() - 1,
                        parts[3].toInt(),
                        parts[4].toInt(),
                        parts[5].toInt(),
                        parts[6].toInt()
                    )
                    set(Calendar.MILLISECOND, fraction.toIntOrNull() ?: 0)
                }.timeInMillis
            }.getOrNull()
        }
    }
}
