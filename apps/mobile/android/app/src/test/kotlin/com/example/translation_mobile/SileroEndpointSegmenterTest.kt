package com.example.translation_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SileroEndpointSegmenterTest {
    @Test
    fun `16k requires speech and trailing silence before one boundary`() {
        val probabilities = listOf(0.8f, 0.8f, 0.8f, 0.8f, 0.1f, 0.1f, 0.1f, 0.1f)
        var reads = 0
        val detector = SileroEndpointSegmenter(VadProbabilityModel {
            probabilities.getOrElse(reads++) { 0.1f }
        },
            16000, 0.6f, 0.35f, 96, 100)
        val results = probabilities.map { detector.acceptPcm16(ByteArray(512 * 2)) }
        assertEquals(listOf(false, false, false, false, false, false, false, true), results)
        assertEquals(8, reads)
        assertFalse(detector.acceptPcm16(ByteArray(512 * 2)))
    }

    @Test
    fun `24k resamples side analysis without dropping or duplicating a model block`() {
        val resampler = Pcm24To16VadResampler()
        var produced = 0
        repeat(24000) { if (resampler.push(0f).isFinite()) produced++ }
        assertEquals(16000, produced)

        val probabilities = listOf(0.8f, 0.8f, 0.8f, 0.1f, 0.1f, 0.1f, 0.1f)
        var reads = 0
        val detector = SileroEndpointSegmenter(VadProbabilityModel { probabilities[reads++] },
            24000, 0.6f, 0.35f, 96, 100)
        val results = probabilities.map { detector.acceptPcm16(ByteArray(768 * 2)) }
        assertEquals(listOf(false, false, false, false, false, false, true), results)
        assertEquals(7, reads)
    }

    @Test
    fun `quiet and invalid model output never fabricate a boundary`() {
        val quiet = SileroEndpointSegmenter(VadProbabilityModel { 0.01f },
            16000, 0.6f, 0.35f, 96, 100)
        repeat(100) { assertFalse(quiet.acceptPcm16(ByteArray(512 * 2))) }
        val invalid = SileroEndpointSegmenter(VadProbabilityModel { Float.NaN },
            16000, 0.6f, 0.35f, 96, 100)
        try {
            invalid.acceptPcm16(ByteArray(512 * 2))
            fail("non-finite model output must fail closed")
        } catch (expected: IllegalStateException) {
            assertTrue(expected.message?.contains("silero_probability_invalid") == true)
        }
    }
}
