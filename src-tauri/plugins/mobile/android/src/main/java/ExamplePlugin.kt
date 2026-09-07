package com.daad.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import app.tauri.PermissionState

@InvokeArg
class UrlArgs { var url: String = "" }

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")])
class MobilePlugin(private val activity: Activity): Plugin(activity) {
    @Command
    fun prepareAudio(invoke: Invoke) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            microphoneResult(invoke)
        } else {
            requestPermissionForAlias("microphone", invoke, "microphoneResult")
        }
    }
    @PermissionCallback
    fun microphoneResult(invoke: Invoke) {
        val result = JSObject()
        result.put("granted", getPermissionState("microphone") == PermissionState.GRANTED)
        invoke.resolve(result)
    }
    @Command
    fun openUrl(invoke: Invoke) {
        val uri = Uri.parse(invoke.parseArgs(UrlArgs::class.java).url)
        if (uri.scheme != "https" && uri.scheme != "http") {
            invoke.reject("Only web links can be opened")
            return
        }
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("Could not open the system browser") }
    }
}
