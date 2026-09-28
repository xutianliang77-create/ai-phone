package com.example.translation_mobile

import kotlin.math.ceil

/** The model sees only a side-analysis copy. The original PCM frame is sent
 * unchanged through the existing Flutter/Gateway audio path. */
internal fun interface VadProbabilityModel {
    fun probability(samples: FloatArray): Float
}

internal class SileroEndpointSegmenter(
    private val model: VadProbabilityModel,
    sampleRate: Int,
    private val threshold: Float,
    private val negativeThreshold: Float,
    minSpeechMs: Int,
    silenceMs: Int,
) {
    private val resampler = if (sampleRate == 24000) Pcm24To16VadResampler() else null
    private val block = FloatArray(512)
    private val speechBlocksRequired = ceil(minSpeechMs / 32.0).toInt()
    private val silenceBlocksRequired = ceil(silenceMs / 32.0).toInt()
    private var blockSize = 0
    private var candidateSpeechBlocks = 0
    private var quietBlocks = 0
    private var activeSpeech = false
    var speechStarted = false
        private set

    init {
        require(sampleRate == 16000 || sampleRate == 24000)
        require(threshold > 0f && threshold < 1f)
        require(negativeThreshold >= 0f && negativeThreshold < threshold)
        require(minSpeechMs in 32..2000 && silenceMs in 100..3000)
    }

    fun acceptPcm16(pcm: ByteArray): Boolean {
        speechStarted = false
        require(pcm.isNotEmpty() && pcm.size % 2 == 0)
        var boundary = false
        for (offset in pcm.indices step 2) {
            val sample = (((pcm[offset].toInt() and 0xff) or
                (pcm[offset + 1].toInt() shl 8)).toShort().toInt() / 32768f)
            val vadSample = resampler?.push(sample) ?: sample
            if (!vadSample.isFinite()) continue
            block[blockSize++] = vadSample
            if (blockSize == block.size) {
                val probability = model.probability(block)
                check(probability.isFinite() && probability in 0f..1f) {
                    "silero_probability_invalid"
                }
                if (advance(probability)) boundary = true
                blockSize = 0
            }
        }
        return boundary
    }

    private fun advance(probability: Float): Boolean {
        if (!activeSpeech) {
            candidateSpeechBlocks = if (probability >= threshold) candidateSpeechBlocks + 1 else 0
            if (candidateSpeechBlocks >= speechBlocksRequired) {
                activeSpeech = true
                speechStarted = true
                quietBlocks = 0
            }
            return false
        }
        quietBlocks = if (probability < negativeThreshold) quietBlocks + 1 else 0
        if (quietBlocks < silenceBlocksRequired) return false
        activeSpeech = false
        candidateSpeechBlocks = 0
        quietBlocks = 0
        return true
    }
}

/** Causal, bounded 24→16 kHz analysis resampler. The half-sample phase is
 * integer-valued, so long sessions cannot accumulate floating-point drift. */
internal class Pcm24To16VadResampler {
    private var inputIndex = 0L
    private var nextOutputHalfSample = 0L
    private var hasPrevious = false
    private var previousFiltered = 0f
    private var previousRaw = 0f

    fun push(raw: Float): Float {
        val filtered = if (hasPrevious) (previousRaw + raw) * 0.5f else raw
        previousRaw = raw
        val currentIndex = inputIndex++
        if (!hasPrevious) {
            hasPrevious = true
            previousFiltered = filtered
            nextOutputHalfSample = 3
            return filtered
        }
        val previousIndex = currentIndex - 1
        val output = if (nextOutputHalfSample <= currentIndex * 2) {
            val fraction = (nextOutputHalfSample - previousIndex * 2) * 0.5f
            nextOutputHalfSample += 3
            previousFiltered + (filtered - previousFiltered) * fraction
        } else Float.NaN
        previousFiltered = filtered
        return output
    }
}
