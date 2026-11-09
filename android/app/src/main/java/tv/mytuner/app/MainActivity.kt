package tv.mytuner.app

import android.app.Activity
import android.app.AlertDialog
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.*
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newFixedThreadPool(3)
    private val tasks = UiTaskQueue(worker)
    private val profileTasks = UiTaskQueue(ProfileRequests)
    private val bg = Color.rgb(16, 26, 32)
    private val panel = Color.rgb(36, 54, 63)
    private val alt = Color.rgb(25, 40, 48)
    private val ink = Color.rgb(239, 250, 255)
    private val muted = Color.rgb(180, 204, 213)
    private val focus = Color.rgb(119, 245, 222)
    private val dark = Color.rgb(16, 43, 44)
    private val prefs by lazy { getSharedPreferences("server", MODE_PRIVATE) }
    private val vault by lazy { TokenVault(this) }
    private val plex by lazy { Typeface.createFromAsset(assets, "fonts/plex.ttf") }
    private val mono by lazy { Typeface.createFromAsset(assets, "fonts/mono.ttf") }
    private var pinKey: ((String) -> Unit)? = null
    private var client: LanApi? = null
    @Volatile private var epoch = 0
    @Volatile private var active = false
    private val dialogs = mutableSetOf<AlertDialog>()
    private var screen = "connect"
    private var profile: JSONObject? = null
    private var channels = JSONArray()
    private var guideShift = 0L
    private var selectedChannel: String? = null
    private lateinit var page: LinearLayout
    private lateinit var message: TextView
    private var headerClock: TextView? = null
    private var player: ExoPlayer? = null
    private var session: JSONObject? = null
    private var delivery: JSONObject? = null
    private var receivedAt = 0L
    private var loadSerial = 0
    private var joining = false
    private var pollInterrupted = false
    private var deliveryFailed = false
    private var controlSerial = 0
    private var controlPending = false
    private var controlInterrupted = false
    private var forceHls = false
    private var audio = -1
    private var captions = emptyList<PlaybackMath.Cue>()
    private var subtitleIndex = -1
    private val captionRequests = CaptionRequests()
    private var captionFailure: String? = null
    private var playingTitle: TextView? = null
    private var contextText: TextView? = null
    private var lastErrorCategory = "none"
    private var playbackStatus: TextView? = null
    private var pauseButton: Button? = null
    private var goLiveButton: Button? = null
    private var subtitleText: TextView? = null
    private var overlay: LinearLayout? = null
    private var errorText: TextView? = null
    private var previousDelivery: Pair<String, Long>? = null
    private var lastEventAt = 0L
    private val scale: Float
        get() = resources.displayMetrics.widthPixels / 1920f

    private fun px(value: Int) = (value * scale).toInt().coerceAtLeast(1)

    private fun api() = client ?: error("Connect to a server first.")

    private fun obj(vararg values: Pair<String, Any?>) =
        JSONObject().apply { values.forEach { (k, v) -> put(k, v) } }

    private fun array(values: JSONArray): List<JSONObject> =
        (0 until values.length()).map { values.getJSONObject(it) }

    private fun clock(value: Long) =
        SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(value))

    private fun shape(color: Int, border: Int = color, stroke: Int = 1) =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = px(6).toFloat()
            setStroke(px(stroke), border)
        }

    private fun text(
        value: String,
        size: Int = 28,
        color: Int = ink,
        bold: Boolean = false,
        monospace: Boolean = false,
    ) =
        TextView(this).apply {
            text = value
            if (bold && size >= 36 && Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
            setTextColor(color)
            setTextSize(
                android.util.TypedValue.COMPLEX_UNIT_PX,
                size * scale * resources.configuration.fontScale,
            )
            typeface =
                if (monospace) mono
                else Typeface.create(plex, if (bold) Typeface.BOLD else Typeface.NORMAL)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = px(16) }
        }

    private fun row() =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = px(16) }
        }

    private fun column(color: Int? = null) =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = px(24) }
            if (color != null) {
                background = shape(color)
                setPadding(px(32), px(32), px(32), px(32))
            }
        }

    private fun button(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            typeface = Typeface.create(plex, Typeface.BOLD)
            setTextSize(
                android.util.TypedValue.COMPLEX_UNIT_PX,
                28 * scale * resources.configuration.fontScale,
            )
            setTextColor(ink)
            background = shape(panel, muted)
            minHeight = px(72)
            minimumHeight = px(72)
            minimumWidth = px(150)
            setPadding(px(24), px(12), px(24), px(12))
            layoutParams =
                LinearLayout.LayoutParams(-2, -2).apply {
                    rightMargin = px(24)
                    bottomMargin = px(16)
                }
            id = View.generateViewId()
            isFocusable = true
            setOnFocusChangeListener { _, has ->
                background =
                    shape(if (has) focus else panel, if (has) focus else muted, if (has) 4 else 1)
                setTextColor(if (has) dark else ink)
            }
            setOnClickListener { action() }
        }

    private fun error(error: Throwable) {
        if (!active) return
        if (error is ApiFailure && error.status == 401) {
            vault.save(null)
            client?.token = null
            pairing()
            return
        }
        lastErrorCategory = ConnectionDiagnostics.category((error as? ApiFailure)?.status)
        val value =
            error.message ?: "Unable to reach your server. Check its address and network access."
        if (screen == "player") {
            errorText?.text = value
            errorText?.visibility = View.VISIBLE
            player?.pause()
            showPlaybackControls(true)
        } else {
            message.text = value
            message.visibility = View.VISIBLE
            if (screen == "pairing") keepPairingFocusVisible()
        }
    }

    private fun keepPairingFocusVisible() {
        val requestEpoch = epoch
        page.post {
            if (active && screen == "pairing" && epoch == requestEpoch) {
                currentFocus?.let { focused ->
                    focused.requestRectangleOnScreen(Rect(0, 0, focused.width, focused.height), true)
                }
            }
        }
    }

    private fun <T> task(
        work: () -> T,
        done: (T) -> Unit,
        failed: ((Throwable) -> Unit)? = null,
        discarded: ((T) -> Unit)? = null,
        profileRequest: Boolean = false,
    ) {
        val requestEpoch = epoch
        val queue = if (profileRequest) profileTasks else tasks
        queue.execute({ active && requestEpoch == epoch }) {
            try {
                val value = work()
                main.post {
                    if (active && requestEpoch == epoch) done(value) else discarded?.invoke(value)
                }
            } catch (e: Throwable) {
                main.post { if (active && requestEpoch == epoch) (failed ?: ::error)(e) }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onStart() {
        super.onStart()
        active = true
        val base = prefs.getString("base", null)
        val token = vault.read()
        client = base?.let { LanApi(it, token) }
        if (base == null) connect() else if (token == null) pairing() else profiles()
    }

    override fun onStop() {
        active = false
        epoch++
        main.removeCallbacksAndMessages(null)
        dismissDialogs()
        stopPlayback()
        super.onStop()
    }

    override fun onDestroy() {
        worker.shutdown()
        super.onDestroy()
    }

    private fun stopPlayback() {
        captionRequests.invalidate()
        captionFailure = null
        loadSerial++
        player?.release()
        player = null
        val id = session?.optString("id")
        val a = client
        session = null
        delivery = null
        joining = false
        pollInterrupted = false
        deliveryFailed = false
        controlSerial++
        controlPending = false
        controlInterrupted = false
        previousDelivery = null
        captions = emptyList()
        overlay = null
        if (!id.isNullOrBlank() && a != null)
            worker.execute { runCatching { a.request("/api/playback/sessions/$id", "DELETE") } }
    }

    private fun showDialog(dialog: AlertDialog) {
        dialogs.add(dialog)
        val previous = currentFocus
        val dialogEpoch = epoch
        dialog.setOnDismissListener { dialogs.remove(dialog); if (active && epoch == dialogEpoch) previous?.requestFocus() }
        dialog.show()
    }

    private fun dismissDialogs() {
        val open = dialogs.toList()
        dialogs.clear()
        open.forEach { it.dismiss() }
    }

    private fun begin(name: String) {
        pinKey = null
        epoch++
        main.removeCallbacksAndMessages(null)
        dismissDialogs()
        if (name != "player") stopPlayback()
        screen = name
    }

    private fun shell(name: String, heading: String, description: String = "") {
        begin(name)
        val root =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(bg)
                setPadding(px(96), px(56), px(96), px(40))
            }
        val header =
            row().apply {
                minimumHeight = px(80)
                gravity = Gravity.CENTER_VERTICAL
                setPadding(px(24), px(12), px(24), px(12))
                background =
                    GradientDrawable(
                            GradientDrawable.Orientation.TOP_BOTTOM,
                            intArrayOf(
                                Color.rgb(251, 254, 255),
                                Color.rgb(217, 226, 230),
                                Color.rgb(195, 206, 211),
                                Color.rgb(228, 236, 239),
                            ),
                        )
                        .apply { cornerRadius = px(6).toFloat() }
            }
        header.addView(
            text("myTuner", 42, dark, true).apply {
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            }
        )
        header.addView(
            text(profile?.optString("name") ?: "Personal television", 26, dark, true).apply {
                maxWidth = px(900)
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                layoutParams = LinearLayout.LayoutParams(-2, -2).apply { rightMargin = px(40) }
            }
        )
        header.addView(
            text(clock(System.currentTimeMillis()), 30, dark, true).apply {
                layoutParams = LinearLayout.LayoutParams(-2, -2)
                headerClock = this
            }
        )
        root.addView(header)
        val scroll =
            ScrollView(this).apply {
                isFillViewport = true
                clipToPadding = false
            }
        page = column().apply { setPadding(0, px(16), 0, 0) }
        page.addView(text(heading, 48, bold = true))
        if (description.isNotEmpty()) page.addView(text(description, 28, muted))
        message =
            text("", 26, Color.rgb(255, 183, 174)).apply {
                visibility = View.GONE
                accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            }
        page.addView(message)
        scroll.addView(page)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }

    private fun connect() {
        profile = null
        shell(
            "connect",
            "Where is your myTuner server?",
            "Enter the address supplied by your administrator.",
        )
        val card = column(panel)
        card.addView(text("SERVER ADDRESS", 24, muted, true, true))
        val address =
            EditText(this).apply {
                setSingleLine(true)
                setText(prefs.getString("base", "http://"))
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                setTextColor(ink)
                setHintTextColor(muted)
                typeface = mono
                setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 36 * scale)
                background = shape(alt, muted)
                setPadding(px(20), px(16), px(20), px(16))
                contentDescription = "Server address"
                minHeight = px(88)
                id = View.generateViewId()
                setOnFocusChangeListener { _, has ->
                    background = shape(alt, if (has) focus else muted, if (has) 4 else 1)
                }
            }
        card.addView(address)
        card.addView(
            text("Use http:// or https:// and include your published Unraid port.", 26, muted)
        )
        page.addView(card)
        val actions = row()
        val connect =
            button("Connect") {
                try {
                    val base = PlaybackMath.serverAddress(address.text.toString())
                    val candidate = LanApi(base)
                    message.text = getString(R.string.connecting)
                    message.visibility = View.VISIBLE
                    task(
                        { candidate.json("/api/health") },
                        { health ->
                            if (health.optString("service") != "mytuner")
                                error(Exception("This address is not a myTuner server."))
                            else if (
                                !ConnectionDiagnostics.compatible(health.optInt("apiVersion", 1))
                            )
                                error(
                                    Exception(
                                        "This server API is incompatible. Update the TV app and server together."
                                    )
                                )
                            else {
                                vault.save(null)
                                client = candidate
                                prefs.edit().putString("base", base).putLong("last-health:$base", System.currentTimeMillis()).putInt("api:$base", health.optInt("apiVersion",1)).putString("version:$base", health.optString("version")).apply()
                                pairing()
                            }
                        },
                    )
                } catch (e: Exception) {
                    error(e)
                }
            }
        address.showSoftInputOnFocus = false
        address.nextFocusDownId = connect.id
        connect.nextFocusUpId = address.id
        address.setOnKeyListener { _, keyCode, event ->
            if (event.action != KeyEvent.ACTION_DOWN) false
            else
                when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_DOWN -> {
                        (getSystemService(INPUT_METHOD_SERVICE)
                                as android.view.inputmethod.InputMethodManager)
                            .hideSoftInputFromWindow(address.windowToken, 0)
                        connect.requestFocus()
                        true
                    }
                    KeyEvent.KEYCODE_DPAD_CENTER,
                    KeyEvent.KEYCODE_ENTER -> {
                        (getSystemService(INPUT_METHOD_SERVICE)
                                as android.view.inputmethod.InputMethodManager)
                            .showSoftInput(
                                address,
                                android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT,
                            )
                        true
                    }
                    else -> false
                }
        }
        actions.addView(connect)
        actions.addView(button("Connection help") { help() })
        page.addView(actions)
        page.addView(text("↑ ↓  Address / Connect     OK  Open keyboard", 24, muted))
        address.requestFocus()
    }

    private fun help() {
        shell("help", "Connect your TV to Unraid", "No media is stored on the TV.")
        page.addView(
            text(
                "1. Install and start the myTuner server on Unraid.\n\n2. Enter http://UNRAID-LAN-IP:8777 (or your published host port).\n\n3. Keep the TV on its existing network. Your router must allow it to reach the server’s address and port.\n\n4. In your browser, sign in and open Connect TV. Approve the code on this screen.\n\n5. Choose a profile, enter its optional PIN, then select a subscribed channel.",
                30,
            )
        )
        page.addView(button("Back to server address") { connect() }.also { it.requestFocus() })
    }

    private fun pairing() {
        if (client == null) {
            connect()
            return
        }
        profile = null
        shell(
            "pairing",
            "Approve this TV in your browser",
            "Your account password stays off the television.",
        )
        val a = api()
        val card = row().apply { background = shape(panel); setPadding(px(32), px(32), px(32), px(32)) }
        val codeArea = column().apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        card.addView(codeArea)
        val qr = ImageView(this).apply { contentDescription = "Scan the public approval code with your phone; sign in and approve explicitly"; layoutParams = LinearLayout.LayoutParams(px(320), px(320)); visibility = View.GONE }
        card.addView(qr)
        val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".take(120)
        codeArea.addView(text(deviceName, 28, muted))
        val code = text("Requesting code…", 112, focus, true, true).apply { setSingleLine(true) }
        codeArea.addView(code)
        val status = text("Waiting for a connection code", 30, bold = true)
        codeArea.addView(status)
        page.addView(card)
        page.addView(
            text(
                "Open ${a.base}/#connect-tv on your computer or phone. Sign in and approve the exact code shown here.",
                30,
            )
        )
        val actions = row()
        actions.addView(button("Get a new code") { pairing() })
        actions.addView(button("Change server") { connect() })
        actions.addView(button("Connection help") { connectionDetails() })
        page.addView(actions)
        task(
            { a.json("/api/auth/pairings", "POST", obj("deviceName" to deviceName)) },
            { result ->
                code.text = result.getString("userCode").chunked(5).joinToString(" ")
                runCatching { PairingQr.bitmap(a.base, result.getString("userCode")) }.onSuccess { qr.setImageBitmap(it); qr.visibility = View.VISIBLE }
                codeArea.addView(text("Scan with your phone or enter this code manually. Approval still requires signing in.", 24, muted))
                keepPairingFocusVisible()
                val device = result.getString("deviceCode")
                val expires =
                    SystemClock.elapsedRealtime() + result.getLong("expiresInSeconds") * 1000
                val delay = (result.getLong("pollIntervalSeconds") * 1000).coerceIn(1000, 30000)
                var retrying = false
                fun countdown() {
                    val remaining =
                        ((expires - SystemClock.elapsedRealtime()) / 1000).coerceAtLeast(0)
                    status.text =
                        if (remaining == 0L) "Connection code expired"
                        else
                            "Expires in %02d:%02d · %s"
                                .format(remaining / 60, remaining % 60, if (retrying) "Connection interrupted · retrying" else "Waiting for your approval")
                    if (remaining > 0) main.postDelayed({ countdown() }, 1000)
                }
                countdown()
                fun poll() {
                    if (SystemClock.elapsedRealtime() >= expires) {
                        error(
                            Exception(
                                "This connection code expired. Choose Get a new code to try again."
                            )
                        )
                        return
                    }
                    task(
                        { a.json("/api/auth/pairings/poll", "POST", obj("deviceCode" to device)) },
                        { answer ->
                            retrying = false
                            if (answer.optString("status") == "approved") {
                                val token = answer.getString("token")
                                vault.save(token)
                                a.token = token
                                profiles()
                            } else main.postDelayed({ poll() }, delay)
                        },
                        { failure ->
                            if (PairingRetry.shouldRetry((failure as? ApiFailure)?.status, SystemClock.elapsedRealtime(), expires)) {
                                retrying = true
                                main.postDelayed({ poll() }, delay)
                            } else if (SystemClock.elapsedRealtime() >= expires) {
                                status.text = "Connection code expired · choose Get a new code"
                            } else error(failure)
                        },
                    )
                }
                main.postDelayed({ poll() }, delay)
            },
        )
        actions.getChildAt(0).requestFocus()
    }

    private fun profiles() {
        profile = null
        shell(
            "profiles",
            "Who’s watching?",
            "Choose a profile. Its PIN unlocks TV access, not account sign-in.",
        )
        val a = api()
        val selection = ProfileSelection()
        val selectionStatus = text("Loading profiles…", 26, muted)
        page.addView(selectionStatus)
        val grid =
            GridLayout(this).apply {
                columnCount = 3
                layoutParams = LinearLayout.LayoutParams(-1, -2)
            }
        page.addView(grid)
        val actions = row()
        actions.addView(button("Retry profiles") { profiles() })
        actions.addView(button("Change server") { connect() })
        actions.addView(
            button("Forget pairing") {
                AlertDialog.Builder(this)
                    .setTitle("Forget this TV’s pairing?")
                    .setMessage("You will need to approve a new code in your browser.")
                    .setPositiveButton("Forget") { _, _ ->
                        val old = api()
                        val reset = {
                            vault.save(null)
                            old.token = null
                            pairing()
                        }
                        task({ old.request("/api/auth/logout", "POST") }, { reset() }, { reset() })
                    }
                    .setNegativeButton("Cancel", null)
                    .create().also(::showDialog)
            }
        )
        page.addView(actions)
        task(
            {
                a.request("/api/playback/startup", "POST")
                JSONArray(a.request("/api/profiles"))
            },
            { rows ->
                selectionStatus.text = ""
                if (rows.length() == 0)
                    page.addView(
                        text(
                            "No profiles are assigned to this account. Ask your administrator to create or grant one.",
                            30,
                            muted,
                        )
                    )
                array(rows).forEach { p ->
                    val b =
                        button(
                            "${p.getString("name")}\n${if(p.optBoolean("pinProtected")) "PIN protected" else if(p.optString("kind") == "room") "Shared room" else "Personal profile"}"
                        ) {
                            if (!selection.begin(p.getString("id"))) return@button
                            selectionStatus.text = "Opening ${p.getString("name")}…"
                            task(
                                {
                                    a.request(
                                        "/api/playback/profiles/${p.getString("id")}/select",
                                        "POST",
                                    )
                                },
                                {
                                    if (selection.complete(p.getString("id"))) {
                                        profile = p
                                        if (p.optBoolean("pinProtected")) pin() else guide()
                                    }
                                },
                                {
                                    selection.complete(p.getString("id"))
                                    selectionStatus.text = "Profile was not opened. Select it to retry."
                                    error(it)
                                },
                                profileRequest = true,
                            )
                        }
                    b.layoutParams =
                        GridLayout.LayoutParams().apply {
                            width = px(528)
                            height = px(196)
                            setMargins(0, 0, px(24), px(24))
                        }
                    grid.addView(b)
                }
                if (grid.childCount > 0) grid.getChildAt(0).requestFocus()
                else actions.getChildAt(0).requestFocus()
            },
            { failure ->
                selectionStatus.text = ""
                error(failure)
            },
            profileRequest = true,
        )
    }

    private fun pin() {
        val p = profile ?: return profiles()
        shell("pin", "Unlock ${p.getString("name")}", "Enter your numeric TV PIN.")
        val input = PinInput()
        val dots = text("○ ○ ○ ○", 52, focus, true, true)
        page.addView(dots)
        fun refresh() {
            dots.text =
                if (input.digits.isEmpty()) "○ ○ ○ ○"
                else input.digits.map { "●" }.joinToString(" ")
        }
        val keypad =
            GridLayout(this).apply {
                columnCount = 3
                layoutParams = LinearLayout.LayoutParams(px(720), -2)
            }
        val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "Delete", "0", "Unlock")
        fun press(key: String) {
            if (input.pending) return
            when (key) {
                "Delete" -> input.delete()
                "Unlock" -> {
                    val entered = input.submit()
                    if (entered == null) error(Exception("Enter a 4–8 digit PIN."))
                    else
                        task(
                            {
                                api()
                                    .request(
                                        "/api/profiles/${p.getString("id")}/unlock",
                                        "POST",
                                        obj("pin" to entered),
                                    )
                            },
                            {
                                input.settled()
                                guide()
                            },
                            {
                                input.settled()
                                error(it)
                            },
                        )
                }
                else -> key.toIntOrNull()?.let(input::digit)
            }
            refresh()
        }
        pinKey = ::press
        keys.forEach { key ->
            val b = button(key) { press(key) }
            b.layoutParams =
                GridLayout.LayoutParams().apply {
                    width = px(216)
                    height = px(88)
                    setMargins(0, 0, px(24), px(16))
                }
            keypad.addView(b)
        }
        page.addView(keypad)
        page.addView(button("Choose another profile") { profiles() })
        keypad.getChildAt(0).requestFocus()
    }

    private fun guide() {
        val p = profile ?: return profiles()
        shell("guide", "On your channels", "Now and next · OK always joins the channel live.")
        val a = api()
        val navigation = row()
        navigation.addView(
            button("← Earlier") {
                    guideShift = (guideShift - 1800000).coerceAtLeast(0)
                    guide()
                }
                .apply { tag = "guide-earlier" }
        )
        navigation.addView(
            button("Now") {
                    guideShift = 0
                    guide()
                }
                .apply { tag = "guide-now" }
        )
        navigation.addView(
            button("Later →") {
                    guideShift = (guideShift + 1800000).coerceAtMost(5 * 3600000)
                    guide()
                }
                .apply { tag = "guide-later" }
        )
        navigation.addView(
            button("Switch profile") {
                    guideShift = 0
                    profiles()
                }
                .apply { tag = "guide-profiles" }
        )
        page.addView(navigation)
        val contentIndex = page.childCount
        fun refreshGuide() {
            val now = System.currentTimeMillis() + guideShift
            main.postDelayed({ refreshGuide() }, 30000)
            task(
                {
                    a.json(
                        "/api/profiles/${p.getString("id")}/guide?startMs=$now&endMs=${now+3600000}"
                    )
                },
                { result ->
                    val focusTag = currentFocus?.tag as? String
                    while (page.childCount > contentIndex) page.removeViewAt(contentIndex)
                    message.visibility = View.GONE
                    headerClock?.text = clock(System.currentTimeMillis())
                    channels = result.getJSONArray("channels")
                    if (channels.length() == 0) {
                        page.addView(
                            text(
                                "Your guide is empty. In the browser, subscribe this profile to permitted channels.",
                                32,
                                muted,
                            )
                        )
                        (focusTag?.let { page.findViewWithTag<View>(it) }
                                ?: navigation.getChildAt(3))
                            .requestFocus()
                        return@task
                    }
                    val content = row().apply { gravity = Gravity.TOP }
                    val list = column()
                    list.layoutParams =
                        LinearLayout.LayoutParams(0, -2, 1.9f).apply { rightMargin = px(24) }
                    val detail = column(alt)
                    detail.layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                    val artwork =
                        ImageView(this).apply {
                            scaleType = ImageView.ScaleType.CENTER_CROP
                            layoutParams = LinearLayout.LayoutParams(-1, px(280))
                            contentDescription = "Program artwork"
                        }
                    detail.addView(artwork)
                    val name = text("Select a program", 36, bold = true)
                    val description = text("", 26, muted)
                    detail.addView(name)
                    detail.addView(description)
                    detail.addView(text("OK to join live", 25, focus, true))
                    var detailSerial = 0
                    array(channels).forEach { channel ->
                        val entries =
                            array(channel.getJSONArray("entries")).filter {
                                it.getLong("endMs") > now
                            }
                        val first = entries.firstOrNull()
                        val next =
                            entries.firstOrNull {
                                it.optString("programId") != first?.optString("programId")
                            }
                        val line =
                            row().apply {
                                background = shape(panel)
                                setPadding(px(16), px(16), px(16), px(16))
                            }
                        line.addView(
                            text(
                                    "${channel.optString("shortName")}\n${channel.getString("name")}",
                                    26,
                                    bold = true,
                                )
                                .apply {
                                    layoutParams =
                                        LinearLayout.LayoutParams(px(230), -2).apply {
                                            rightMargin = px(16)
                                        }
                                }
                        )
                        listOfNotNull(first, next).forEachIndexed { entryIndex, entry ->
                            val b =
                                button(
                                    "${entry.optString("title","Scheduled video")}\n${clock(entry.getLong("startMs"))} – ${clock(entry.getLong("endMs"))}"
                                ) {
                                    startChannel(channel.getString("id"))
                                }
                            b.minimumHeight = px(104)
                            b.tag = "guide-channel:${channel.getString("id")}:$entryIndex"
                            b.layoutParams =
                                LinearLayout.LayoutParams(0, -2, 1f).apply {
                                    rightMargin = px(12)
                                }
                            val original = b.onFocusChangeListener
                            b.onFocusChangeListener =
                                View.OnFocusChangeListener { v, has ->
                                    original?.onFocusChange(v, has)
                                    if (has) {
                                        selectedChannel = channel.getString("id")
                                        val serial = ++detailSerial
                                        name.text = entry.optString("title")
                                        description.text = listOf(channel.getString("name"), channel.optString("description")).filter { it.isNotBlank() }.joinToString("\n")
                                        artwork.setImageDrawable(shape(panel))
                                        task(
                                            {
                                                a.json(
                                                    "/api/profiles/${p.getString("id")}/media/${entry.getString("mediaId")}"
                                                )
                                            },
                                            { m ->
                                                if (serial == detailSerial) {
                                                    name.text =
                                                        m.optJSONObject("metadata")
                                                            ?.optString("seriesTitle")
                                                            ?.takeIf { it.isNotBlank() }
                                                            ?: m.getString("title")
                                                    description.text = listOf(
                                                        channel.optString("description"),
                                                        m.optJSONObject("metadata")?.optString("overview")?.takeIf { it.isNotBlank() } ?: m.getString("title"),
                                                    ).filter { it.isNotBlank() }.joinToString("\n\n")
                                                    val url =
                                                        m.optJSONObject("metadata")
                                                            ?.optJSONArray("images")
                                                            ?.optJSONObject(0)
                                                            ?.optString("url")
                                                    if (!url.isNullOrBlank())
                                                        loadArtwork(a, url, artwork) {
                                                            serial == detailSerial
                                                        }
                                                }
                                            },
                                            {},
                                        )
                                    }
                                }
                            line.addView(b)
                        }
                        if (first == null)
                            line.addView(
                                text("Programming needs administrator attention", 25, muted)
                            )
                        list.addView(line)
                    }
                    content.addView(list)
                    content.addView(detail)
                    page.addView(content)
                    val selected =
                        array(channels)
                            .indexOfFirst { it.getString("id") == selectedChannel }
                            .coerceAtLeast(0)
                    val retainedFocus = focusTag?.let { page.findViewWithTag<View>(it) }
                    (retainedFocus
                            ?: (list.getChildAt(selected) as? ViewGroup)?.getChildAt(1)
                            ?: navigation.getChildAt(1))
                        .requestFocus()
                    page.addView(
                        text(
                            "↑ ↓  Channels     ← →  Current / next     OK  Watch live     Back  Profiles",
                            24,
                            muted,
                        )
                    )
                },
            )
        }
        message.text = "Loading your channels…"
        message.visibility = View.VISIBLE
        refreshGuide()
    }

    private fun loadArtwork(a: LanApi, url: String, view: ImageView, valid: () -> Boolean) {
        task(
            {
                val c = a.connection(url)
                try {
                    if (c.responseCode != 200) throw Exception("Artwork unavailable")
                    val bytes = c.inputStream.use { it.readBytesLimit(5 * 1024 * 1024) }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                } finally {
                    c.disconnect()
                }
            },
            { if (valid()) view.setImageBitmap(it) },
            {},
        )
    }

    private fun java.io.InputStream.readBytesLimit(max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val n = read(buffer)
            if (n < 0) break
            if (out.size() + n > max) throw Exception("Artwork is too large")
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }

    private fun startChannel(id: String) {
        if (profile == null) return profiles()
        stopPlayback()
        begin("player")
        selectedChannel = id
        polling = false
        forceHls = false
        audio = -1
        subtitleIndex = -1
        val frame = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val playerView =
            PlayerView(this).apply {
                useController = false
                setKeepContentOnPlayerReset(true)
                isFocusable = false
                isFocusableInTouchMode = false
            }
        frame.addView(playerView, FrameLayout.LayoutParams(-1, -1))
        player =
            ExoPlayer.Builder(this)
                .setMediaSourceFactory(
                    DefaultMediaSourceFactory(DataSource.Factory { LanMediaSource(api()) })
                )
                .build()
                .also { p1 ->
                    playerView.player = p1
                    p1.addListener(
                        object : Player.Listener {
                            override fun onPlayerError(error: PlaybackException) {
                                if (delivery?.optString("mode") == "direct" && !forceHls) {
                                    forceHls = true
                                    session?.let { loadDelivery(it) }
                                } else {
                                    deliveryFailed = true
                                    this@MainActivity.error(
                                        Exception(
                                            "Playback interrupted. Retry or choose another channel."
                                        )
                                    )
                                }
                            }

                            override fun onRenderedFirstFrame() {
                                playerView.contentDescription = "Video playing"
                                if (!pollInterrupted && !controlPending && !controlInterrupted)
                                    errorText?.visibility = View.GONE
                            }

                            override fun onPlaybackStateChanged(state: Int) {
                                if (state == Player.STATE_BUFFERING) {
                                    playerView.contentDescription = "Video buffering"
                                }
                                if (state == Player.STATE_ENDED) pollPlayback()
                            }
                        }
                    )
                }
        subtitleText =
            text("", 34, ink, true).apply {
                gravity = Gravity.CENTER
                setBackgroundColor(0x88000000.toInt())
                visibility = View.GONE
            }
        applyCaptionStyle()
        frame.addView(
            subtitleText,
            FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply {
                setMargins(px(260), 0, px(260), px(260))
            },
        )
        errorText =
            text("Joining your channel…", 32).apply {
                accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
                gravity = Gravity.CENTER
                setBackgroundColor(0xcc101a20.toInt())
                setPadding(px(24), px(24), px(24), px(24))
            }
        frame.addView(errorText, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
            setMargins(px(96), px(56), px(96), 0)
        })
        overlay = column(alt).apply { setPadding(px(32), px(24), px(32), px(24)) }
        val controls = overlay!!
        controls.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> positionCaptions() }
        controls.addView(
            text(
                array(channels).find { it.getString("id") == id }?.getString("name")
                    ?: "Your channel",
                24,
                muted,
                true,
                true,
            )
        )
        playingTitle = text("myTuner", 42, bold = true)
        controls.addView(playingTitle)
        playbackStatus = text("LIVE", 28, focus, true, true)
        controls.addView(playbackStatus)
        contextText = text("", 25, muted)
        controls.addView(contextText)
        val actions = row()
        pauseButton =
            button("Pause") {
                control(if (session?.optBoolean("paused") == true) "resume" else "pause")
            }
        actions.addView(pauseButton)
        goLiveButton = button("Go Live") { control("goLive") }
        actions.addView(goLiveButton)
        actions.addView(button("Channel guide") { guide() })
        actions.addView(button("Audio") { chooseTrack(false) })
        actions.addView(button("Subtitles") { chooseTrack(true) })
        actions.addView(
            button("Retry") {
                val current = session
                if (current == null) joinChannel(id) else loadDelivery(current)
            }
        )
        for (index in 0 until actions.childCount) {
            actions.getChildAt(index).layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply {
                rightMargin = px(16); bottomMargin = px(16)
            }
        }
        controls.addView(actions)
        val channelActions = row()
        channelActions.addView(button("← Previous channel") { zap(-1) })
        channelActions.addView(button("Next channel →") { zap(1) })
        channelActions.addView(button("Browse channels") { browseChannels() })
        channelActions.addView(button("More options") {
            AlertDialog.Builder(this).setTitle("Playback options").setItems(arrayOf("Caption style", "Recently aired", "Report a problem", "Connection help")) { _, index ->
                when(index) { 0 -> captionStyle(); 1 -> recentPrograms(id); 2 -> reportProblem(); 3 -> connectionDetails() }
            }.setNegativeButton("Close", null).create().also(::showDialog)
        })
        for (index in 0 until channelActions.childCount) {
            channelActions.getChildAt(index).layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply {
                rightMargin = px(16); bottomMargin = px(16)
            }
        }
        controls.addView(channelActions)
        frame.addView(
            controls,
            FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply {
                setMargins(px(96), 0, px(96), px(56))
            },
        )
        setContentView(frame)
        pauseButton?.requestFocus()
        joinChannel(id)
    }

    private fun recentPrograms(channelId: String) {
        val p = profile ?: return
        val content = column(panel)
        val status = text("Loading retained airings…", 24, muted)
        content.addView(status)
        val dialog = AlertDialog.Builder(this).setTitle("Recently aired")
            .setView(ScrollView(this).apply { addView(content) })
            .setNegativeButton("Close", null).create()
        showDialog(dialog)
        val a = api()
        task({ a.json("/api/profiles/${p.getString("id")}/channels/$channelId/recent") }, { data ->
            if (!dialog.isShowing) return@task
            status.text = "Last two hours · retained scheduled airings only. This may be a partial window. No replay or viewing record."
            val items = data.getJSONArray("items")
            if (items.length() == 0) content.addView(text("No retained programs in this window.", 26))
            array(items).forEach { item ->
                val date = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())
                val episode = if (item.isNull("seasonNumber")) "" else " · S${item.getInt("seasonNumber")} E${if(item.isNull("episodeNumber")) "?" else item.getInt("episodeNumber")}"
                content.addView(text("${item.getString("title")}$episode\n${date.format(Date(item.getLong("startMs")))} – ${date.format(Date(item.getLong("endMs")))}", 26))
            }
            if (data.optBoolean("truncated")) content.addView(text("Showing the latest 200 retained programs.", 22, muted))
        }, { if (dialog.isShowing) status.text = "Recent airings unavailable. Close and reopen to retry." })
    }

    private fun reportProblem() {
        val current = session ?: return
        val sessionId = current.getString("id")
        val categories = arrayOf("Picture", "Sound", "Captions", "Other")
        AlertDialog.Builder(this).setTitle("Report a playback problem")
            .setItems(categories) { _, index -> reviewProblem(sessionId, categories[index].lowercase(Locale.ROOT)) }
            .setNegativeButton("Cancel", null).create().also(::showDialog)
    }

    private fun reviewProblem(sessionId: String, category: String) {
        val content = column(panel)
        val status = text("Preparing a summary. Nothing has been sent.", 24)
        content.addView(status)
        val dialog = AlertDialog.Builder(this).setTitle("Review problem report")
            .setView(ScrollView(this).apply { addView(content) })
            .setNegativeButton("Cancel / Close", null).create()
        showDialog(dialog)
        val a = api()
        val requestId = UUID.randomUUID().toString()
        task({ a.json("/api/playback/sessions/$sessionId/report-preview", "POST", obj("category" to category, "client" to "tv")) }, { draft ->
            if (!dialog.isShowing) return@task
            val summary = draft.getJSONObject("summary")
            status.text = "Exact summary to send to your administrator. No logs, files, screenshots, credentials or PINs.\n" +
                listOf("category", "client", "appVersion", "serverTime", "channelId", "entryId", "state", "route").joinToString("\n") { key -> "$key: ${summary.get(key)}" }
            var pending = false
            val send = button("Send report") {}
            send.setOnClickListener {
                if (!pending) {
                    pending = true
                    send.text = "Sending…"
                    task({ a.json("/api/problem-reports", "POST", obj("draftId" to draft.getString("draftId"), "requestId" to requestId)) }, { report ->
                        if (dialog.isShowing) {
                            status.text = "Report sent. Reference ${report.getString("id")}"
                            content.removeView(send)
                        }
                    }, {
                        pending = false
                        if (dialog.isShowing) {
                            send.text = "Retry sending report"
                            status.text = "Not sent or delivery unconfirmed. Retry sends the same report once. If playback changed or the summary expired, close and review a new report.\n" + summary.toString(2)
                        }
                    })
                }
            }
            content.addView(send)
            send.requestFocus()
        }, { if (dialog.isShowing) status.text = "Summary unavailable. Nothing sent. Close and reopen to retry." })
    }

    private fun joinChannel(id: String) {
        val p = profile ?: return
        if (joining || session != null) return
        joining = true
        errorText?.text = getString(R.string.joining)
        errorText?.visibility = View.VISIBLE
        val a = api()
        task(
            {
                a.json(
                    "/api/playback/sessions",
                    "POST",
                    obj("profileId" to p.getString("id"), "channelId" to id),
                )
            },
            { s ->
                joining = false
                session = s
                receivedAt = SystemClock.elapsedRealtime()
                loadDelivery(s)
                schedulePoll()
                tickCaptions()
            },
            {
                joining = false
                error(it)
            },
            { s ->
                CleanupDispatcher.execute(worker) {
                    runCatching {
                        a.request("/api/playback/sessions/${s.getString("id")}", "DELETE")
                    }
                }
            },
        )
    }

    private fun zap(delta: Int) {
        val index = array(channels).indexOfFirst { it.getString("id") == selectedChannel }
        val next = (index + delta + channels.length()) % channels.length().coerceAtLeast(1)
        if (channels.length() > 0) startChannel(channels.getJSONObject(next).getString("id"))
    }

    private fun control(action: String) {
        val s = session ?: return
        if (controlPending || controlInterrupted) return
        val serial = ++controlSerial
        controlPending = true
        captionRequests.invalidate()
        renderStatus()
        deliveryFailed = false
        loadSerial++
        player?.pause()
        val a = api()
        task(
            { a.json("/api/playback/sessions/${s.getString("id")}/$action", "POST") },
            { next ->
                if (serial != controlSerial) return@task
                controlPending = false
                controlInterrupted = false
                session = next
                receivedAt = SystemClock.elapsedRealtime()
                previousDelivery = null
                if (next.optBoolean("paused")) {
                    loadSerial++
                    player?.stop()
                    player?.clearMediaItems()
                    errorText?.visibility = View.GONE
                    renderStatus()
                } else loadDelivery(next)
            },
            { failure ->
                if (serial == controlSerial) {
                    controlPending = false
                    controlInterrupted = true
                    renderStatus()
                    error(failure)
                    pollPlayback()
                }
            },
        )
    }

    private fun renderStatus() {
        val s = session ?: return
        pauseButton?.text = if (s.optBoolean("paused")) "Resume" else "Pause"
        // Keep the focused remote control in place while its request reconciles.
        pauseButton?.isClickable = !controlPending && !controlInterrupted
        val behind = s.optLong("behindLiveMs")
        playbackStatus?.text =
            if (s.optBoolean("paused")) "PAUSED ON THIS DEVICE"
            else if (behind > 2000) "${behind/1000} SECONDS BEHIND LIVE" else "● LIVE"
        val context = s.optJSONObject("context")
        val program = context?.optJSONObject("program")
        contextText?.text = if (context == null) "" else listOf(
            if (context.optString("kind") == "commercial") "Commercial · ${(context.optLong("remainingMs") + 999)/1000} seconds remaining · ${program?.optString("title") ?: "Programming resumes next"}"
            else "${context.optString("title")} · ${if (context.isNull("seasonNumber")) "" else "S${context.optInt("seasonNumber")} E${context.optInt("episodeNumber")}"}",
            "Next: ${context.optJSONObject("next")?.optString("title") ?: "More to come"}",
        ).joinToString("\n")
        goLiveButton?.isEnabled = s.optBoolean("paused") || behind > 2000
        goLiveButton?.isClickable = !controlPending && !controlInterrupted
    }

    private fun deliveryIdentity(s: JSONObject?, generation: Int = loadSerial): DeliveryIdentity? {
        val current = s ?: return null
        val entry = current.optJSONObject("playback")?.optJSONObject("entry") ?: return null
        return DeliveryIdentity(
            current.optString("id"),
            entry.optString("id"),
            current.optString("revisionId"),
            generation,
        )
    }

    private fun loadDelivery(s: JSONObject) {
        if (controlPending || controlInterrupted) return
        val serial = ++loadSerial
        renderStatus()
        // Same-entry paused recovery invalidates media negotiations, not the
        // retained source-time cue or an in-flight caption response.
        if (s.optBoolean("available") && s.optBoolean("paused")) return
        captionRequests.invalidate()
        captionFailure = null
        captions = emptyList()
        if (!s.optBoolean("available")) {
            delivery = null
            player?.stop()
            errorText?.text = getString(R.string.unavailable)
            errorText?.visibility = View.VISIBLE
            return
        }
        if (s.optBoolean("paused")) return
        val context = deliveryIdentity(s, serial) ?: return
        deliveryFailed = false
        val a = api()
        val entry = s.getJSONObject("playback").getJSONObject("entry")
        errorText?.text = getString(R.string.joining)
        errorText?.visibility = View.VISIBLE
        val direct = !forceHls && audio < 0 && prefs.getString(preferenceKey("audio"), null) == null
        val capabilities =
            obj(
                "containers" to
                    JSONArray(if (direct) listOf("mp4", "m4v") else emptyList<String>()),
                "videoCodecs" to JSONArray(if (direct) listOf("h264") else emptyList<String>()),
                "audioCodecs" to
                    JSONArray(if (direct) listOf("aac", "mp3") else emptyList<String>()),
            )
        task(
            {
                val d =
                    a.json(
                        "/api/playback/sessions/${s.getString("id")}/negotiate",
                        "POST",
                        capabilities,
                    )
                val m =
                    a.json(
                        "/api/profiles/${s.getString("profileId")}/media/${entry.getString("mediaId")}"
                    )
                Pair(d, m)
            },
            { (d, m) ->
                if (
                    !context.canPlay(
                        deliveryIdentity(session),
                        session?.optBoolean("available") == true,
                        session?.optBoolean("paused") == true,
                    )
                )
                    return@task
                delivery = d
                if (audio < 0) audio = preferredTrack(d, "audio")
                if (subtitleIndex < 0) subtitleIndex = preferredTrack(d, "subtitle")
                playingTitle?.text =
                    m.optJSONObject("metadata")?.optString("seriesTitle")?.takeIf {
                        it.isNotBlank()
                    } ?: m.getString("title")
                val url = d.getString("url") + (if (audio >= 0) "?audioTrack=$audio" else "")
                val media = MediaItem.fromUri(PlaybackMath.mediaAddress(a.base, url))
                player?.setMediaItem(media)
                player?.prepare()
                if (d.getString("mode") == "direct") player?.seekTo(d.getLong("sourceOffsetMs"))
                player?.playWhenReady = true
                previousDelivery = null
                if (subtitleIndex >= 0) loadCaptions(subtitleIndex)
            },
            { failure ->
                if (
                    context.canPlay(
                        deliveryIdentity(session),
                        session?.optBoolean("available") == true,
                        session?.optBoolean("paused") == true,
                    )
                ) {
                    deliveryFailed = true
                    error(failure)
                }
            },
        )
    }

    private fun schedulePoll() {
        main.postDelayed(
            {
                if (screen == "player" && active) {
                    pollPlayback()
                    schedulePoll()
                }
            },
            1000,
        )
    }

    private var polling = false

    private fun pollPlayback() {
        val old = session ?: return
        if (polling || controlPending) return
        polling = true
        val serial = controlSerial
        val a = api()
        task(
            { a.json("/api/playback/sessions/${old.getString("id")}") },
            { next ->
                polling = false
                if (
                    serial != controlSerial ||
                        controlPending ||
                        session?.optString("id") != next.optString("id")
                )
                    return@task
                recordDelivery()
                val changed =
                    old.optJSONObject("playback")?.optJSONObject("entry")?.optString("id") !=
                        next.optJSONObject("playback")?.optJSONObject("entry")?.optString("id") ||
                        old.optString("revisionId") != next.optString("revisionId")
                session = next
                receivedAt = SystemClock.elapsedRealtime()
                val recover = (pollInterrupted || controlInterrupted) && !deliveryFailed
                pollInterrupted = false
                controlInterrupted = false
                renderStatus()
                if (changed) {
                    captionRequests.invalidate()
                    captionFailure = null
                    audio = -1
                    subtitleIndex = -1
                    captions = emptyList()
                }
                val availabilityChanged = old.optBoolean("available") != next.optBoolean("available")
                if (changed || availabilityChanged || recover) {
                    if (next.optBoolean("paused") && !deliveryFailed) {
                        loadSerial++
                        player?.stop()
                        player?.clearMediaItems()
                        errorText?.visibility = View.GONE
                    }
                    loadDelivery(next)
                }
            },
            {
                polling = false
                if (serial == controlSerial && !controlPending) {
                    pollInterrupted = true
                    loadSerial++
                    error(it)
                }
            },
        )
    }

    private fun channelPosition(): Long {
        val s = session ?: return 0
        if (s.optBoolean("paused")) return s.optLong("positionMs")
        val p = player ?: return s.optLong("positionMs")
        val e =
            s.optJSONObject("playback")?.optJSONObject("entry") ?: return s.optLong("positionMs")
        if (delivery?.optString("mode") == "direct")
            return PlaybackMath.channelPosition(
                e.getLong("startMs"),
                e.getLong("offsetMs"),
                p.currentPosition,
            )
        val timeline = p.currentTimeline
        if (!timeline.isEmpty) {
            val w = timeline.getWindow(p.currentMediaItemIndex, Timeline.Window())
            if (w.windowStartTimeMs != C.TIME_UNSET) return w.windowStartTimeMs + p.currentPosition
        }
        return s.optLong("positionMs") +
            if (s.optBoolean("paused")) 0 else SystemClock.elapsedRealtime() - receivedAt
    }

    private fun recordDelivery() {
        val s = session ?: return
        val e = s.optJSONObject("playback")?.optJSONObject("entry") ?: return
        val p = player ?: return
        if (!p.isPlaying || s.optBoolean("paused")) {
            previousDelivery = null
            return
        }
        val position = channelPosition()
        val id = e.getString("id")
        val last = previousDelivery
        val now = SystemClock.elapsedRealtime()
        if (last == null) {
            previousDelivery = Pair(id, position)
            lastEventAt = now
            return
        }
        if (now - lastEventAt < 4000) return
        previousDelivery = Pair(id, position)
        lastEventAt = now
        val from = last.second.coerceAtLeast(e.getLong("startMs"))
        val to = position.coerceAtMost(e.getLong("endMs"))
        if (last.first != id || to <= from || to - from > 10000) return
        val a = api()
        worker.execute {
            runCatching {
                a.request(
                    "/api/playback/sessions/${s.getString("id")}/events",
                    "POST",
                    obj(
                        "id" to UUID.randomUUID().toString(),
                        "entryId" to id,
                        "startMs" to from,
                        "endMs" to to,
                    ),
                )
            }
        }
    }

    private fun browseChannels() {
        val p = profile ?: return
        val content = column(panel)
        val status = text("Loading your lineup…", 26, muted)
        content.addView(status)
        val dialog = AlertDialog.Builder(this).setTitle("Browse channels")
            .setView(ScrollView(this).apply { addView(content) }).setNegativeButton("Close", null).create()
        showDialog(dialog)
        val a = api()
        task({ a.json("/api/profiles/${p.getString("id")}/guide") }, { result ->
            if (!dialog.isShowing) return@task
            status.text = if (result.getJSONArray("channels").length() == 0)
                "No channels are available. Close and ask your administrator to review this profile’s subscriptions. Current playback is unchanged."
            else "Browsing keeps your current playback. Watch live switches channels."
            array(result.getJSONArray("channels")).forEach { channel ->
                val entries = array(channel.getJSONArray("entries")).filter { it.optLong("endMs") > System.currentTimeMillis() }
                val current = entries.firstOrNull()
                val next = entries.firstOrNull { it.optString("programId") != current?.optString("programId") }
                content.addView(text("${channel.getString("name")}\nNow: ${current?.optString("title") ?: "No programming"} · Next: ${next?.optString("title") ?: "More to come"}", 26))
                content.addView(button("Watch ${channel.getString("name")} live") {
                    val tune = { dialog.dismiss(); startChannel(channel.getString("id")) }
                    if (session?.optBoolean("paused") == true) AlertDialog.Builder(this).setTitle("Discard this paused position?").setMessage("The selected channel joins live.").setPositiveButton("Watch live") { _, _ -> tune() }.setNegativeButton("Cancel", null).create().also(::showDialog)
                    else tune()
                }.apply { isEnabled = current != null })
            }
        }, { if (dialog.isShowing) status.text = "Lineup unavailable. Close and try again; current playback is unchanged." })
    }

    private fun applyCaptionStyle() {
        val size = prefs.getString(preferenceKey("caption-size"), "normal")
        subtitleText?.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, (if (size == "largest") 54 else if (size == "large") 44 else 34) * scale * resources.configuration.fontScale)
        val shadow = prefs.getString(preferenceKey("caption-background"), "dark") == "shadow"
        subtitleText?.setBackgroundColor(if (shadow) Color.TRANSPARENT else 0xcc000000.toInt())
        subtitleText?.setShadowLayer(if (shadow) 4f else 0f, 0f, 2f, Color.BLACK)
    }

    private fun captionStyle() {
        val choices = arrayOf("Normal · dark background", "Large · dark background", "Largest · dark background", "Normal · text shadow", "Large · text shadow", "Largest · text shadow")
        val sizes = listOf("normal", "large", "largest")
        var selected = sizes.indexOf(prefs.getString(preferenceKey("caption-size"), "normal")).coerceAtLeast(0) + if (prefs.getString(preferenceKey("caption-background"), "dark") == "shadow") 3 else 0
        val sample = text("Caption preview · The next program begins soon.", 34, Color.WHITE).apply { setPadding(px(16), px(16), px(16), px(16)) }
        fun preview() {
            sample.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, (listOf(34,44,54)[selected % 3]) * scale * resources.configuration.fontScale)
            sample.setBackgroundColor(if(selected < 3) 0xcc000000.toInt() else Color.TRANSPARENT)
            sample.setShadowLayer(if(selected >= 3) 4f else 0f, 0f, 2f, Color.BLACK)
        }
        preview()
        AlertDialog.Builder(this).setTitle("Caption appearance · this device and profile")
            .setView(sample)
            .setSingleChoiceItems(choices, selected) { _, index -> selected = index; preview() }
            .setPositiveButton("Apply") { _, _ ->
                prefs.edit().putString(preferenceKey("caption-size"), sizes[selected % 3]).putString(preferenceKey("caption-background"), if (selected < 3) "dark" else "shadow").apply()
                applyCaptionStyle()
            }.setNegativeButton("Cancel", null).create().also(::showDialog)
    }

    private fun connectionDetails() {
        val a = client ?: run { connect(); return }
        val content = column(panel)
        val last = prefs.getLong("last-health:${a.base}", 0)
        val description = text("Server: ${a.base}\nDevice: ${Build.MANUFACTURER} ${Build.MODEL} · Android API ${Build.VERSION.SDK_INT}\nLast successful health check: ${if (last == 0L) "Not recorded" else java.text.DateFormat.getDateTimeInstance().format(Date(last))}\nAPI: ${prefs.getInt("api:${a.base}", 0)} · Server version: ${prefs.getString("version:${a.base}", "Unknown")}\nLast error: $lastErrorCategory\nUnreachable: check server address and network access. Expired authorization: get a new pairing code. Denied access: ask your administrator to review profile grants. Unavailable/unsupported media: choose another channel and report the problem.", 25)
        content.addView(description)
        val dialog = AlertDialog.Builder(this).setTitle("Connection details and help").setView(ScrollView(this).apply { addView(content) }).setNegativeButton("Close", null).create()
        content.addView(button("Check server") {
            task({ a.json("/api/health") }, { health -> if (dialog.isShowing) {
                val compatible = ConnectionDiagnostics.compatible(health.optInt("apiVersion", 0)) && health.optString("service") == "mytuner"
                description.text = if (compatible) "Server reachable and API compatible. Close to return to your current screen." else "Server API incompatible. Update the TV app and server together."
                if (compatible) prefs.edit().putLong("last-health:${a.base}", System.currentTimeMillis()).putInt("api:${a.base}", health.optInt("apiVersion")).putString("version:${a.base}", health.optString("version")).apply()
            } }, { if (dialog.isShowing) description.text = "Server check failed. Verify its address, published port and network access. Your current screen and pairing are unchanged." })
        })
        content.addView(button("Change server address") { dialog.dismiss(); connect() })
        showDialog(dialog)
    }

    private fun preferenceKey(kind: String): String =
        "track:${client?.base}:${profile?.optString("id")}:$kind"

    private fun preferredTrack(d: JSONObject, kind: String): Int {
        val language = prefs.getString(preferenceKey(kind), null)
        val tracks =
            array(d.optJSONArray("tracks") ?: JSONArray()).filter {
                it.optString("type") == kind && (kind != "subtitle" || it.has("url"))
            }
        return TrackPreferences.match(
            language,
            tracks.map { TrackPreferences.Track(it.getInt("index"), it.optString("language")) },
        )
    }

    private fun chooseTrack(subtitles: Boolean) {
        val context = deliveryIdentity(session) ?: return
        val advertised = delivery
        val tracks =
            array(delivery?.optJSONArray("tracks") ?: JSONArray())
                .filter { it.optString("type") == (if (subtitles) "subtitle" else "audio") }
                .filter { !subtitles || it.has("url") }
        val labels =
            listOf(if (subtitles) "Off" else "Default audio") +
                tracks.map { track ->
                    track.optString("title").ifBlank {
                        track.optString("language").ifBlank { "Track ${track.getInt("index")}" }
                    }
                }
        AlertDialog.Builder(this)
            .setTitle(if (subtitles) "Subtitles" else "Audio")
            .setItems(labels.toTypedArray()) { _, index ->
                if (!context.canSelect(deliveryIdentity(session), delivery === advertised))
                    return@setItems
                val selected = if (index == 0) -1 else tracks[index - 1].getInt("index")
                val kind = if (subtitles) "subtitle" else "audio"
                val language =
                    if (index == 0) null
                    else TrackPreferences.language(tracks[index - 1].optString("language"))
                prefs.edit().putString(preferenceKey(kind), language).apply()
                if (subtitles) {
                    subtitleIndex = selected
                    loadCaptions(selected)
                } else {
                    audio = selected
                    session?.let { loadDelivery(it) }
                }
            }
            .setNegativeButton("Cancel", null)
            .create().also(::showDialog)
    }

    private fun loadCaptions(index: Int) {
        captionRequests.invalidate()
        captionFailure = null
        captions = emptyList()
        subtitleText?.text = ""
        subtitleText?.visibility = View.GONE
        val s = session ?: return
        val track =
            array(delivery?.optJSONArray("tracks") ?: JSONArray()).find {
                it.optInt("index") == index && it.has("url")
            } ?: return
        val entry = s.optJSONObject("playback")?.optJSONObject("entry") ?: return
        val a = api()
        val request =
            captionRequests.begin(s.getString("id"), entry.getString("id"), loadSerial, index)
        task(
            { PlaybackMath.captions(a.request(track.getString("url"))) },
            { if (captionRequests.isCurrent(request)) captions = it },
            { failure ->
                if (captionRequests.isCurrent(request)) {
                    if (failure is ApiFailure && failure.status == 401) error(failure)
                    else {
                        captionFailure = "Subtitles unavailable. Select subtitles to retry."
                        if (failure is ApiFailure && failure.status == 403) pollPlayback()
                    }
                }
            },
        )
    }

    private fun showPlaybackControls(visible: Boolean) {
        overlay?.visibility = if (visible) View.VISIBLE else View.GONE
        positionCaptions()
    }

    private fun positionCaptions() {
        val caption = subtitleText ?: return
        val layout = caption.layoutParams as? FrameLayout.LayoutParams ?: return
        val parent = caption.parent as? View ?: return
        val controls = overlay
        val desired = if (controls?.visibility == View.VISIBLE) controls.height + px(72) else px(260)
        val maximum = (parent.height - caption.height.coerceAtLeast(px(96)) - px(24)).coerceAtLeast(0)
        val bottom = desired.coerceAtMost(maximum)
        if (layout.bottomMargin != bottom) {
            layout.bottomMargin = bottom
            caption.layoutParams = layout
        }
    }

    private fun tickCaptions() {
        main.postDelayed(
            {
                if (active && screen == "player") {
                    val e = session?.optJSONObject("playback")?.optJSONObject("entry")
                    if (e != null) {
                        val source =
                            PlaybackMath.sourcePosition(
                                e.getLong("startMs"),
                                e.getLong("offsetMs"),
                                channelPosition(),
                            )
                        val value =
                            captionFailure
                                ?: captions
                                    .filter { it.start <= source && it.end > source }
                                    .joinToString("\n") { it.text }
                        subtitleText?.text = value
                        subtitleText?.visibility = if (value.isEmpty()) View.GONE else View.VISIBLE
                        positionCaptions()
                    }
                    tickCaptions()
                }
            },
            250,
        )
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (screen == "pin" && event.action == KeyEvent.ACTION_DOWN) {
            val key =
                when (event.keyCode) {
                    in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 ->
                        (event.keyCode - KeyEvent.KEYCODE_0).toString()
                    in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 ->
                        (event.keyCode - KeyEvent.KEYCODE_NUMPAD_0).toString()
                    KeyEvent.KEYCODE_DEL -> "Delete"
                    KeyEvent.KEYCODE_ENTER,
                    KeyEvent.KEYCODE_NUMPAD_ENTER -> "Unlock"
                    else -> null
                }
            if (key != null) {
                if (event.repeatCount == 0) pinKey?.invoke(key)
                return true
            }
        }
        if (screen == "player" && event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                KeyEvent.KEYCODE_MEDIA_PLAY,
                KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                    val command =
                        when (event.keyCode) {
                            KeyEvent.KEYCODE_MEDIA_PLAY -> TransportControls.Command.PLAY
                            KeyEvent.KEYCODE_MEDIA_PAUSE -> TransportControls.Command.PAUSE
                            else -> TransportControls.Command.TOGGLE
                        }
                    TransportControls.action(command, session?.optBoolean("paused") == true)
                        ?.let(::control)
                    return true
                }
                KeyEvent.KEYCODE_DPAD_CENTER,
                KeyEvent.KEYCODE_DPAD_UP,
                KeyEvent.KEYCODE_DPAD_DOWN,
                KeyEvent.KEYCODE_DPAD_LEFT,
                KeyEvent.KEYCODE_DPAD_RIGHT -> {
                    if (overlay?.visibility != View.VISIBLE) {
                        showPlaybackControls(true)
                        pauseButton?.requestFocus()
                        return true
                    }
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("TV Back uses explicit screen hierarchy")
    override fun onBackPressed() {
        when (screen) {
            "player" ->
                if (overlay?.visibility == View.VISIBLE) {
                    showPlaybackControls(false)
                } else guide()
            "guide",
            "pin" -> profiles()
            "profiles" -> finish()
            "pairing",
            "help" -> connect()
            else -> finish()
        }
    }
}
