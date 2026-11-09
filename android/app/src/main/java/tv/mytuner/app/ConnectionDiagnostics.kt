package tv.mytuner.app

object ConnectionDiagnostics {
    fun compatible(apiVersion: Int) = apiVersion == 1

    fun category(status: Int?): String =
        when (status) {
            401 -> "authorization-expired"
            403 -> "access-denied"
            404,
            409 -> "content-unavailable"
            422 -> "unsupported-media"
            429 -> "server-busy"
            500,
            502,
            503,
            504 -> "server-unavailable"
            else -> "connection-failed"
        }
}
