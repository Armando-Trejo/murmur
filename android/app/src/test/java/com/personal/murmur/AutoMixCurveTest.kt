package com.personal.murmur
import org.junit.Test
import org.junit.Assert.*
class AutoMixCurveTest {
    @Test fun summedPowerStaysConstantThroughoutTransition() { for (i in 0..100) { val (a,b) = AutoMixCurve.gains(i / 100.0); assertEquals(1.0, (a*a+b*b).toDouble(), 0.000001); assertTrue(a in 0f..1f && b in 0f..1f) } }
    @Test fun endpointsAndClampingDoNotAmplifyOrInvertAudio() { assertEquals(1f,AutoMixCurve.gains(-1.0).first,0.00001f); assertEquals(0f,AutoMixCurve.gains(0.0).second,0.00001f); assertEquals(0f,AutoMixCurve.gains(1.0).first,0.00001f); assertEquals(1f,AutoMixCurve.gains(2.0).second,0.00001f) }
}
