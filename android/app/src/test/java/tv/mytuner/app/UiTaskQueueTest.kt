package tv.mytuner.app

import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.*
import org.junit.Test

class UiTaskQueueTest {
    @Test fun obsoleteGuideBacklogDoesNotRunBeforeFreshJoin() {
        val worker = Executors.newFixedThreadPool(3)
        val queue = UiTaskQueue(worker)
        val oldCurrent = AtomicBoolean(true)
        val started = CountDownLatch(3)
        val release = CountDownLatch(1)
        val joined = CountDownLatch(1)
        val performed = Collections.synchronizedList(mutableListOf<Int>())
        try {
            repeat(3) { queue.execute({ true }) { started.countDown(); release.await(5, TimeUnit.SECONDS) } }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            repeat(30) { n -> queue.execute({ oldCurrent.get() }) { performed.add(n) } }
            oldCurrent.set(false)
            queue.execute({ true }) { joined.countDown() }
            release.countDown()
            assertTrue(joined.await(5, TimeUnit.SECONDS))
            assertTrue(performed.isEmpty())
        } finally { release.countDown(); worker.shutdownNow() }
    }

    @Test fun profileMutationsStayOrderedAcrossNewScreensAndActivityQueues() {
        val oldQueue = UiTaskQueue(ProfileRequests)
        val rebuiltQueue = UiTaskQueue(ProfileRequests)
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val completed = CountDownLatch(1)
        val effects = Collections.synchronizedList(mutableListOf<String>())
        try {
            oldQueue.execute({ true }) {
                started.countDown()
                release.await(5, TimeUnit.SECONDS)
                effects.add("old select")
            }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            rebuiltQueue.execute({ true }) { effects.add("new startup") }
            rebuiltQueue.execute({ true }) { effects.add("new select"); completed.countDown() }
            assertFalse(completed.await(100, TimeUnit.MILLISECONDS))
            release.countDown()
            assertTrue(completed.await(5, TimeUnit.SECONDS))
            assertEquals(listOf("old select", "new startup", "new select"), effects.toList())
        } finally { release.countDown() }
    }
}
