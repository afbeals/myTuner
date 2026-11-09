package tv.mytuner.app

object TransportControls {
    enum class Command {
        PLAY,
        PAUSE,
        TOGGLE,
    }

    fun action(command: Command, paused: Boolean): String? =
        when (command) {
            Command.PLAY -> if (paused) "resume" else null
            Command.PAUSE -> if (paused) null else "pause"
            Command.TOGGLE -> if (paused) "resume" else "pause"
        }
}
