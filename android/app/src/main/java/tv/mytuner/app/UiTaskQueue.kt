package tv.mytuner.app

import java.util.concurrent.Executor
import java.util.concurrent.Executors

/** Discard obsolete queued UI work before it consumes a network worker. */
class UiTaskQueue(private val executor: Executor) {
    fun execute(current: () -> Boolean, work: () -> Unit) {
        executor.execute { if (current()) work() }
    }
}

/** Startup/select mutate device sessions. Share one lane across screen rebuilds
 * and Activity recreation so a late old selection cannot overtake a newer one.
 * This executor is process-owned; an Activity must not shut it down. */
object ProfileRequests : Executor {
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "mytuner-profile-requests").apply { isDaemon = true }
    }
    override fun execute(command: Runnable) = executor.execute(command)
}
