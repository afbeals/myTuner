package tv.mytuner.app

data class DeliveryIdentity(
    val session: String,
    val entry: String,
    val revision: String,
    val generation: Int,
) {
    fun canPlay(current: DeliveryIdentity?, available: Boolean, paused: Boolean): Boolean =
        this == current && available && !paused

    fun canSelect(current: DeliveryIdentity?, sameDelivery: Boolean) =
        this == current && sameDelivery
}
