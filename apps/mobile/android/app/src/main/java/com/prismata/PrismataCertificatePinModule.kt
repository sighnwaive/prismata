package com.prismata

import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.URL
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

class PrismataCertificatePinModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "PrismataCertificatePin"

  @ReactMethod
  fun request(urlValue: String, expectedFingerprint: String, method: String, headers: ReadableMap, body: String?, promise: Promise) {
    var connection: HttpsURLConnection? = null
    try {
      val uri = Uri.parse(urlValue)
      require(uri.scheme == "https") { "certificate pinning requires HTTPS" }
      require(expectedFingerprint.matches(Regex("[0-9a-fA-F]{64}"))) { "invalid certificate fingerprint" }
      require(method.matches(Regex("GET|POST|PUT|DELETE|PATCH"))) { "unsupported HTTP method" }

      connection = URL(urlValue).openConnection() as? HttpsURLConnection
        ?: throw IllegalArgumentException("certificate pinning requires HTTPS")
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000
      connection.requestMethod = method
      val keys = headers.keySetIterator()
      while (keys.hasNextKey()) {
        val key = keys.nextKey()
        connection.setRequestProperty(key, headers.getString(key))
      }
      connection.connect()
      verifyPeerCertificate(connection, expectedFingerprint)
      if (body != null) {
        connection.doOutput = true
        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      val status = connection.responseCode
      val stream = if (status >= 400) connection.errorStream else connection.inputStream
      val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
      val response = WritableNativeMap()
      response.putInt("status", status)
      response.putString("body", responseBody)
      promise.resolve(response)
    } catch (error: Throwable) {
      promise.reject("CERTIFICATE_PIN_FAILED", error.message ?: "pinned request failed", error)
    } finally {
      connection?.disconnect()
    }
  }

  private fun verifyPeerCertificate(connection: HttpsURLConnection, expectedFingerprint: String) {
    val certificate = connection.serverCertificates.firstOrNull() ?: throw IllegalStateException("peer certificate unavailable")
    val actualFingerprint = MessageDigest.getInstance("SHA-256")
      .digest(certificate.encoded)
      .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    if (!MessageDigest.isEqual(actualFingerprint.toByteArray(), expectedFingerprint.lowercase().toByteArray())) {
      throw SecurityException("certificate fingerprint mismatch")
    }
  }
}
