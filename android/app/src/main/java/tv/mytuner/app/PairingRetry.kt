package tv.mytuner.app

object PairingRetry {
    fun shouldRetry(status: Int?, now: Long, expires: Long): Boolean =
        now < expires && (status == null || status == 408 || status == 429 || status in 500..599)
}
