package com.example.translation_mobile

import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.util.Locale

class MainActivity : FlutterActivity() {
    private val audioSessionCoordinator = AudioSessionCoordinator(this)
    private val systemAsrBridge = AndroidSystemAsrBridge(this, audioSessionCoordinator)
    private val pcmAudioOutputBridge = PcmAudioOutputBridge(this, audioSessionCoordinator)
    private val speechOutputBridge = AndroidSpeechOutputBridge(this, audioSessionCoordinator)
    private val mediaProjectionBridge = EnterpriseMediaProjectionBridge(this)

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        audioSessionCoordinator.register(flutterEngine.dartExecutor.binaryMessenger)
        systemAsrBridge.register(flutterEngine.dartExecutor.binaryMessenger)
        pcmAudioOutputBridge.register(flutterEngine.dartExecutor.binaryMessenger)
        speechOutputBridge.register(flutterEngine.dartExecutor.binaryMessenger)
        mediaProjectionBridge.register(flutterEngine.dartExecutor.binaryMessenger)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "translation_mobile/ocr"
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "recognizeImage" -> recognizeImage(
                    call.argument<String>("imagePath"),
                    call.argument<List<String>>("scripts"),
                    result
                )
                else -> result.notImplemented()
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        if (mediaProjectionBridge.onRequestPermissionsResult(requestCode, grantResults)) return
        if (systemAsrBridge.onRequestPermissionsResult(requestCode, grantResults)) return
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    override fun onDestroy() {
        systemAsrBridge.destroy()
        pcmAudioOutputBridge.destroy()
        speechOutputBridge.destroy()
        mediaProjectionBridge.destroy()
        audioSessionCoordinator.destroy()
        super.onDestroy()
    }

    private fun recognizeImage(
        imagePath: String?,
        rawScripts: List<String>?,
        result: MethodChannel.Result
    ) {
        val path = imagePath?.trim().orEmpty()
        if (path.isEmpty()) {
            result.error("ocr_missing_image", "No image path was provided.", null)
            return
        }
        val image = try {
            InputImage.fromFilePath(this, Uri.fromFile(File(path)))
        } catch (error: Exception) {
            result.error("ocr_invalid_image", error.localizedMessage, null)
            return
        }
        val scripts = rawScripts?.filter { it == "chinese" || it == "latin" }
            ?.takeIf { it.isNotEmpty() }
            ?: listOf("chinese", "latin")
        val texts = mutableListOf<String>()
        val blocks = mutableListOf<Map<String, Any>>()
        val usedScripts = mutableListOf<String>()
        recognizeScript(image, scripts, 0, texts, blocks, usedScripts, result)
    }

    private fun recognizeScript(
        image: InputImage,
        scripts: List<String>,
        index: Int,
        texts: MutableList<String>,
        blocks: MutableList<Map<String, Any>>,
        usedScripts: MutableList<String>,
        result: MethodChannel.Result
    ) {
        if (index >= scripts.size) {
            result.success(
                mapOf(
                    "text" to texts.joinToString("\n\n"),
                    "provider" to "android_mlkit",
                    "scripts" to usedScripts,
                    "blocks" to blocks
                )
            )
            return
        }

        val script = scripts[index]
        val recognizer = if (script == "latin") {
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        } else {
            TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        }
        recognizer.process(image)
            .addOnSuccessListener { recognizedText ->
                val text = normalizeOcrText(recognizedText.text)
                if (text.isNotEmpty()) mergeOcrText(texts, text)
                appendOcrBlocks(
                    blocks,
                    recognizedText.textBlocks.mapNotNull { block ->
                        val bounds = block.boundingBox ?: return@mapNotNull null
                        val blockText = normalizeOcrText(block.text)
                        if (blockText.isEmpty()) return@mapNotNull null
                        mapOf(
                            "text" to blockText,
                            "left" to bounds.left.toDouble() / image.width,
                            "top" to bounds.top.toDouble() / image.height,
                            "width" to bounds.width().toDouble() / image.width,
                            "height" to bounds.height().toDouble() / image.height
                        )
                    }
                )
                usedScripts.add(script)
                recognizer.close()
                recognizeScript(
                    image,
                    scripts,
                    index + 1,
                    texts,
                    blocks,
                    usedScripts,
                    result
                )
            }
            .addOnFailureListener { error ->
                recognizer.close()
                result.error("ocr_failed", error.localizedMessage, null)
            }
    }

    private fun appendOcrBlocks(
        target: MutableList<Map<String, Any>>,
        incoming: List<Map<String, Any>>
    ) {
        incoming.forEach { block ->
            val text = block["text"] as? String ?: return@forEach
            val compact = compactOcrText(text)
            if (target.none { compactOcrText(it["text"] as? String ?: "") == compact }) {
                target.add(block)
            }
        }
    }

    private fun mergeOcrText(texts: MutableList<String>, next: String) {
        for (index in texts.indices) {
            val current = texts[index]
            if (compactOcrText(current) == compactOcrText(next) || current.contains(next)) return
            if (next.contains(current)) {
                texts[index] = next
                return
            }
        }
        texts.add(next)
    }

    private fun normalizeOcrText(text: String): String {
        return text.lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .joinToString("\n")
            .trim()
    }

    private fun compactOcrText(text: String): String {
        return text.replace(Regex("\\s+"), "").lowercase(Locale.US)
    }
}
