package com.example.translation_mobile

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.res.AssetManager
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/** A session-local Silero stream. No microphone or network access is owned by
 * this class; it only evaluates 512 samples from the existing capture stream. */
internal class SileroOnnxVad private constructor(
    private val environment: OrtEnvironment,
    private val options: OrtSession.SessionOptions,
    private val session: OrtSession,
    private val sampleRateTensor: OnnxTensor,
    @Suppress("unused") private val modelBuffer: ByteBuffer,
) : VadProbabilityModel, AutoCloseable {
    private var state = Array(2) { Array(1) { FloatArray(128) } }
    private val context = FloatArray(64)

    override fun probability(samples: FloatArray): Float {
        require(samples.size == 512)
        val input = Array(1) { FloatArray(576) }
        System.arraycopy(context, 0, input[0], 0, 64)
        System.arraycopy(samples, 0, input[0], 64, 512)
        OnnxTensor.createTensor(environment, input).use { inputTensor ->
            OnnxTensor.createTensor(environment, state).use { stateTensor ->
                session.run(mapOf(
                    "input" to inputTensor,
                    "state" to stateTensor,
                    "sr" to sampleRateTensor,
                )).use { output ->
                    @Suppress("UNCHECKED_CAST")
                    val probability = (output[0].value as Array<FloatArray>)[0][0]
                    @Suppress("UNCHECKED_CAST")
                    val nextState = output[1].value as Array<Array<FloatArray>>
                    check(probability.isFinite() && probability in 0f..1f &&
                        nextState.size == 2 && nextState[0].size == 1 &&
                        nextState[0][0].size == 128) { "silero_output_invalid" }
                    state = nextState
                    System.arraycopy(samples, 448, context, 0, 64)
                    return probability
                }
            }
        }
    }

    private fun reset() {
        state = Array(2) { Array(1) { FloatArray(128) } }
        context.fill(0f)
    }

    override fun close() {
        sampleRateTensor.close()
        session.close()
        options.close()
    }

    companion object {
        private const val ASSET = "models/silero_vad_v6.2.3.onnx"
        private const val SHA256 =
            "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"

        fun load(assets: AssetManager): SileroOnnxVad {
            val bytes = assets.open(ASSET).use { it.readBytes() }
            val actual = MessageDigest.getInstance("SHA-256").digest(bytes)
                .joinToString("") { "%02x".format(it) }
            check(actual == SHA256) { "silero_model_hash_mismatch" }
            val modelBuffer = ByteBuffer.allocateDirect(bytes.size)
                .order(ByteOrder.nativeOrder()).put(bytes)
            modelBuffer.flip()
            val environment = OrtEnvironment.getEnvironment()
            val options = OrtSession.SessionOptions().apply {
                setInterOpNumThreads(1)
                setIntraOpNumThreads(1)
            }
            val session = try {
                environment.createSession(modelBuffer, options)
            } catch (error: Exception) {
                options.close()
                throw error
            }
            val sampleRateTensor = try {
                val rate = ByteBuffer.allocateDirect(Long.SIZE_BYTES)
                    .order(ByteOrder.nativeOrder()).asLongBuffer()
                rate.put(16000L)
                rate.rewind()
                // The pinned v6.2.3 model declares sr as a scalar, not [1].
                OnnxTensor.createTensor(environment, rate, longArrayOf())
            } catch (error: Exception) {
                session.close()
                options.close()
                throw error
            }
            val model = SileroOnnxVad(environment, options, session,
                sampleRateTensor, modelBuffer)
            try {
                model.probability(FloatArray(512))
                model.reset()
                return model
            } catch (error: Exception) {
                model.close()
                throw error
            }
        }
    }
}
