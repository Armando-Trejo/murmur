package com.personal.murmur

import java.io.IOException

/** Adapted from NewTube 6f96a1b/SabrException (MIT): no signed URL/body-bearing cause. */
class YoutubeSourceFailure(val reason:String,val httpStatus:Int = -1):IOException(
    "YouTube no pudo entregar audio reproducible. Reintenta o prueba otra versión. ($reason${if(httpStatus>0)" · HTTP $httpStatus" else ""})"
)
