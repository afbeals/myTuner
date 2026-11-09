package tv.mytuner.app

// A stream index is only meaningful within the delivery that advertised it.
class CaptionRequests {
    data class Request(
        val sessionId: String,
        val entryId: String,
        val delivery: Int,
        val track: Int,
    )

    private var current: Request? = null

    fun begin(sessionId: String, entryId: String, delivery: Int, track: Int): Request {
        return Request(sessionId, entryId, delivery, track).also { current = it }
    }

    fun isCurrent(request: Request): Boolean = current === request

    fun invalidate() {
        current = null
    }
}
