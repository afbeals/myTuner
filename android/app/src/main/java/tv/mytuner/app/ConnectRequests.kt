package tv.mytuner.app

/** Only the latest submission may save a server or report a connection failure. */
class ConnectRequests {
    class Attempt internal constructor()

    @Volatile private var latest: Attempt? = null

    fun begin(): Attempt = Attempt().also { latest = it }

    fun isCurrent(attempt: Attempt): Boolean = latest === attempt
}
