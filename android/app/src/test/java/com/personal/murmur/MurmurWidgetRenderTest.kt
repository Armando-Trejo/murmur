package com.personal.murmur

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/** The layouts go through real RemoteViews inflation, so an unsupported view or a missing id fails here. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MurmurWidgetRenderTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun text(view: View, id: Int) = view.findViewById<TextView>(id).text.toString()

    @Test fun emptyCardInvitesToChooseMusicAndOpensMurmur() {
        assumeTrue(HybridMediaService.instance?.track == null)
        val manager = AppWidgetManager.getInstance(context)
        val id = shadowOf(manager).createWidget(MurmurWidgetProvider::class.java, R.layout.murmur_widget_regular)
        MurmurWidget.refresh(context)
        val view = shadowOf(manager).getViewFor(id)
        assertEquals("MURMUR", text(view, R.id.murmur_widget_title))
        assertEquals("Toca para elegir música", text(view, R.id.murmur_widget_artist))
        assertEquals(View.GONE, view.findViewById<View>(R.id.murmur_widget_controls).visibility)
        assertTrue("The whole card opens MURMUR", view.findViewById<View>(android.R.id.background).hasOnClickListeners())
    }

    @Test fun shortWidgetsGetTheOneRowLayout() {
        val manager = AppWidgetManager.getInstance(context)
        val id = shadowOf(manager).createWidget(MurmurWidgetProvider::class.java, R.layout.murmur_widget_regular)
        manager.updateAppWidgetOptions(id, Bundle().apply { putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 60) })
        MurmurWidget.refresh(context)
        val view = shadowOf(manager).getViewFor(id)
        assertNull("The brand mark belongs to the tall card only", view.findViewById<View>(R.id.murmur_widget_brand))
        assertNotNull(view.findViewById<View>(R.id.murmur_widget_play))
        assertTrue(view.findViewById<View>(android.R.id.background).hasOnClickListeners())
    }

    @Test fun playingSongShowsItsTextAndPauseAndTheButtonPausesIt() {
        val manager = AppWidgetManager.getInstance(context)
        val id = shadowOf(manager).createWidget(MurmurWidgetProvider::class.java, R.layout.murmur_widget_regular)
        val controller = Robolectric.buildService(HybridMediaService::class.java).create()
        try {
            val service = controller.get()
            val song = JSONObject().put("id", "test:widget").put("queueId", "q-widget").put("source", "youtube")
                .put("title", "Luz  de luna").put("artist", "Artista")
            service.play(File(context.cacheDir, "widget-test.mp3").toURI().toString(), song)
            var view = shadowOf(manager).getViewFor(id)
            assertEquals("Luz de luna", text(view, R.id.murmur_widget_title))
            assertEquals("Artista", text(view, R.id.murmur_widget_artist))
            assertEquals(View.VISIBLE, view.findViewById<View>(R.id.murmur_widget_controls).visibility)
            assertEquals("Pausar", view.findViewById<View>(R.id.murmur_widget_play).contentDescription.toString())
            assertTrue(view.findViewById<View>(R.id.murmur_widget_next).hasOnClickListeners())

            MurmurWidgetActions().onReceive(context, Intent(MurmurWidget.ACTION_TOGGLE))
            assertFalse(service.primaryPlayer.playWhenReady)
            MurmurWidget.sync(context)
            view = shadowOf(manager).getViewFor(id)
            assertEquals("Reproducir", view.findViewById<View>(R.id.murmur_widget_play).contentDescription.toString())
        } finally {
            controller.destroy()
        }
        // Once the playback service is gone the card goes back to inviting a choice.
        assertEquals("Toca para elegir música", text(shadowOf(manager).getViewFor(id), R.id.murmur_widget_artist))
    }
}
