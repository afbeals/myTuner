package tv.mytuner.app

import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

// A completed join still needs cleanup if its Activity has already shut down its worker.
object CleanupDispatcher {
    fun execute(executor: Executor, cleanup: () -> Unit) {
        val action = Runnable { cleanup() }
        try {
            executor.execute(action)
        } catch (_: RejectedExecutionException) {
            Thread(action, "mytuner-session-cleanup").apply { isDaemon = true }.start()
        }
    }
}
