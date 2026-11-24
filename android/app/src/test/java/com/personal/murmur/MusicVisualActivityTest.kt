package com.personal.murmur
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[26,28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MusicVisualActivityTest {
 @Test fun visualControlsPauseResumeAndClosingKeepsBackgroundAudio() {
  val service=Robolectric.buildService(HybridMediaService::class.java).create()
  val activity=Robolectric.buildActivity(MusicVisualActivity::class.java).create().start().resume()
  try {
   fun buttons(view:View):List<Button> = if(view is Button)listOf(view) else if(view is ViewGroup)(0 until view.childCount).flatMap{buttons(view.getChildAt(it))}else emptyList()
   val root=activity.get().window.decorView
   val controls=buttons(root)
   assertTrue(controls.any{it.contentDescription=="Anterior"});assertTrue(controls.any{it.contentDescription=="Siguiente"})
   val toggle=controls.first{it.text=="Reproducir"}
   toggle.performClick();assertTrue(service.get().primaryPlayer.playWhenReady)
   toggle.performClick();assertFalse(service.get().primaryPlayer.playWhenReady)
   service.get().primaryPlayer.play()
   root.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));root.layout(0,0,360,800)
   root.draw(Canvas(Bitmap.createBitmap(360,800,Bitmap.Config.ARGB_8888)))
   controls.first{it.text=="Volver a MURMUR"}.performClick();assertTrue(activity.get().isFinishing)
   activity.pause().stop();assertTrue(service.get().primaryPlayer.playWhenReady)
  }finally{activity.destroy();service.destroy()}
 }
 @Test @Config(sdk=[28]) @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
 fun renderPremiumSurfaceWithLongSingleLineTitle() {
  val service=Robolectric.buildService(HybridMediaService::class.java).create()
  org.robolectric.util.ReflectionHelpers.setField(service.get(),"track",org.json.JSONObject().put("title","Afuera (El nervio del volcán · versión de álbum)").put("artist","Caifanes").put("duration",290))
  val activity=Robolectric.buildActivity(MusicVisualActivity::class.java).create().start().resume()
  try{
   org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
   val root=activity.get().window.decorView
   root.measure(View.MeasureSpec.makeMeasureSpec(390,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(844,View.MeasureSpec.EXACTLY));root.layout(0,0,390,844)
   fun stage(view:View):AuraStageView? = when(view) {
    is AuraStageView -> view
    is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { stage(view.getChildAt(it)) }
    else -> null
   }
   val aura=checkNotNull(stage(root))
   aura.allowMotion=false
   aura.setArtwork(android.graphics.BitmapFactory.decodeFile("../../verification/fixtures/cover-2.jpg"))
   val bitmap=Bitmap.createBitmap(390,844,Bitmap.Config.ARGB_8888);root.draw(Canvas(bitmap))
   val file=java.io.File("../../verification/visualizer-25.png");file.parentFile?.mkdirs();file.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
   fun titles(view:View):List<android.widget.TextView> = if(view is ViewGroup)(0 until view.childCount).flatMap{titles(view.getChildAt(it))}else if(view is android.widget.TextView)listOf(view)else emptyList()
   val title=titles(root).first{it.text.startsWith("Afuera")};assertEquals(1,title.maxLines);assertEquals(android.text.TextUtils.TruncateAt.MARQUEE,title.ellipsize)
  }finally{activity.pause().stop().destroy();service.destroy()}
 }

}


