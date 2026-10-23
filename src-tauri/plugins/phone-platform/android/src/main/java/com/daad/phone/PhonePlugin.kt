package com.daad.phone

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

@InvokeArg
class AccountArgs { lateinit var id: String; var value: String? = null }
@InvokeArg
class SessionArgs { var enabled: Boolean = false; var sequence: Long = 0 }
@InvokeArg
class StateArgs { lateinit var state: String; var sequence: Long = 0 }
@InvokeArg
class UrlArgs { lateinit var url: String }

@TauriPlugin
class PhonePlugin(private val activity: Activity): Plugin(activity) {
    private external fun nativeInitialize()
    private val preferences get() = activity.getSharedPreferences("daad-accounts", Context.MODE_PRIVATE)
    private val alias = "daad-account-encryption-v1"
    private var lastSequence: Long = 0
    override fun load(webView: WebView) {
        nativeInitialize()
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = permissions.filter { activity.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) activity.requestPermissions(missing.toTypedArray(), 700)
    }
    override fun onDestroy(activity: AppCompatActivity) {
        if (!activity.isChangingConfigurations) activity.stopService(Intent(activity, PhoneService::class.java))
        super.onDestroy(activity)
    }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Command
    fun store(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AccountArgs::class.java)
            require(args.id.isNotBlank())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val encrypted = cipher.doFinal(requireNotNull(args.value).toByteArray(Charsets.UTF_8))
            val value = Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
            check(preferences.edit().putString(args.id, value).commit())
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("Could not save the encrypted account") }
    }
    @Command
    fun load(invoke: Invoke) {
        try {
            val id = invoke.parseArgs(AccountArgs::class.java).id
            require(id.isNotBlank())
            val encoded = preferences.getString(id, null)
            val value = encoded?.let {
                val bytes = Base64.decode(it, Base64.NO_WRAP)
                require(bytes.size > 28)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                    init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                }
                String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
            }
            invoke.resolve(JSObject().put("value", value ?: org.json.JSONObject.NULL))
        } catch (_: Exception) { invoke.reject("Could not unlock the saved account; reconnect your account") }
    }
    @Command
    fun delete(invoke: Invoke) {
        try {
            val id = invoke.parseArgs(AccountArgs::class.java).id
            require(id.isNotBlank())
            check(preferences.edit().remove(id).commit())
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("Could not remove the saved account") }
    }
    @Command
    fun prepare(invoke: Invoke) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            invoke.reject("Microphone permission is required")
        } else invoke.resolve(JSObject())
    }
    @Command
    fun systemCa(invoke: Invoke) {
        try {
            val manager = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(null as KeyStore?) }
            val roots = manager.trustManagers.filterIsInstance<X509TrustManager>().flatMap { it.acceptedIssuers.toList() }
            val pem = roots.joinToString("\n") { "-----BEGIN CERTIFICATE-----\n" + Base64.encodeToString(it.encoded, Base64.NO_WRAP).chunked(64).joinToString("\n") + "\n-----END CERTIFICATE-----\n" }
            require(pem.isNotBlank())
            invoke.resolve(JSObject().put("value", pem))
        } catch (_: Exception) { invoke.reject("Could not read Android trusted certificates") }
    }
    @Command
    fun session(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SessionArgs::class.java)
            lastSequence = maxOf(lastSequence, args.sequence)
            val intent = Intent(activity, PhoneService::class.java)
            if (args.enabled) {
                if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent) else activity.startService(intent)
            } else activity.stopService(intent)
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("Could not start the Android calling service; open Daad and reconnect") }
    }
    @Command
    fun callState(invoke: Invoke) {
        val args = invoke.parseArgs(StateArgs::class.java)
        if (args.sequence > lastSequence) {
            lastSequence = args.sequence
            PhoneService.update(activity, args.state)
        }
        invoke.resolve(JSObject())
    }
    @Command
    fun openUrl(invoke: Invoke) {
        try {
            val uri = Uri.parse(invoke.parseArgs(UrlArgs::class.java).url)
            require(uri.scheme == "https" || uri.scheme == "http")
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("Could not open web link") }
    }
}
