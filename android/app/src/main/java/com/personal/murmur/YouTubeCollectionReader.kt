package com.personal.murmur
import org.json.JSONObject
import org.json.JSONArray
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
object YouTubeCollectionReader {
 fun read(id:String):JSONObject {
  require(id.matches(Regex("[A-Za-z0-9_-]{2,120}"))){"Identificador YouTube inválido"}
  NativeNetwork.init()
  val url="https://www.youtube.com/playlist?list=$id"
  val info=PlaylistInfo.getInfo(ServiceList.YouTube,url)
  val tracks=JSONArray();val ids=mutableSetOf<String>()
  fun add(items:List<org.schabi.newpipe.extractor.stream.StreamInfoItem>){for(item in items){
   val video=android.net.Uri.parse(item.url).getQueryParameter("v")?:continue
   if(!video.matches(Regex("[A-Za-z0-9_-]{11}"))||!ids.add(video))continue
   tracks.put(JSONObject().put("id","yt:$video").put("source","youtube").put("videoId",video).put("title",item.name).put("artist",item.uploaderName?:"Artista no identificado").put("duration",item.duration).put("artworkUrl",item.thumbnails.maxByOrNull { it.width * it.height.coerceAtLeast(1) }?.url).put("tags",JSONArray()).put("saved",true))
  }}
  add(info.relatedItems);var page=info.nextPage;val seen=mutableSetOf<String>()
  if(!id.startsWith("RD"))repeat(100){
   if(page==null||!org.schabi.newpipe.extractor.Page.isValid(page))return@repeat
   check(seen.add(page.toString())){"YouTube repitió una página; no se reemplazaron datos."}
   val more=PlaylistInfo.getMoreItems(ServiceList.YouTube,url,page);add(more.items);page=more.nextPage
  }
  if(!id.startsWith("RD"))check(page==null||!org.schabi.newpipe.extractor.Page.isValid(page)){"La colección supera el límite de páginas."}
  return JSONObject().put("title",info.name).put("artworkUrl",info.thumbnails.maxByOrNull { it.width * it.height.coerceAtLeast(1) }?.url).put("tracks",tracks)
 }
}
