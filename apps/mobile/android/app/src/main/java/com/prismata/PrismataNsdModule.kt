package com.prismata

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import java.util.Locale
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

class PrismataNsdModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object {
    private const val SERVICE_TYPE = "_prismata._tcp"
    private const val DISCOVERY_TIMEOUT_MS = 1500L

    fun isPrismataServiceType(serviceType: String): Boolean {
      return normalizeServiceType(serviceType) == SERVICE_TYPE
    }

    private fun normalizeServiceType(serviceType: String): String {
      var normalized = serviceType.trim().lowercase(Locale.ROOT)
      if (normalized.endsWith('.')) normalized = normalized.dropLast(1)
      return normalized.removeSuffix(".local")
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var discovery: NsdManager.DiscoveryListener? = null

  override fun getName(): String = "PrismataNsd"

  @ReactMethod
  fun discover(promise: Promise) {
    stopDiscovery()
    val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    val results = Arguments.createArray()
    var settled = false
    lateinit var listener: NsdManager.DiscoveryListener

    fun finish() {
      if (settled) return
      settled = true
      stopDiscovery()
      promise.resolve(results)
    }

    listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) = Unit

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        if (!isPrismataServiceType(serviceInfo.serviceType)) return
        manager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
          override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) = Unit

          override fun onServiceResolved(info: NsdServiceInfo) {
            val host = info.host?.hostAddress ?: return
            val service = Arguments.createMap()
            service.putString("type", "prismata")
            service.putString("protocol", "tcp")
            service.putString("host", host)
            service.putInt("port", info.port)
            service.putMap("txt", attributes(info))
            results.pushMap(service)
          }
        })
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit

      override fun onDiscoveryStopped(serviceType: String) {
        if (!settled) finish()
      }

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        if (settled) return
        settled = true
        stopDiscovery()
        promise.reject("NSD_DISCOVERY_FAILED", "Android local network discovery failed ($errorCode)")
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
    }

    discovery = listener
    manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    handler.postDelayed({ finish() }, DISCOVERY_TIMEOUT_MS)
  }

  @ReactMethod
  fun stop() {
    stopDiscovery()
  }

  private fun stopDiscovery() {
    val listener = discovery ?: return
    val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    runCatching { manager.stopServiceDiscovery(listener) }
    discovery = null
  }

  private fun attributes(info: NsdServiceInfo): WritableMap {
    val txt = Arguments.createMap()
    info.attributes.forEach { (key, value) ->
      txt.putString(key, value.toString(Charsets.UTF_8))
    }
    return txt
  }
}
