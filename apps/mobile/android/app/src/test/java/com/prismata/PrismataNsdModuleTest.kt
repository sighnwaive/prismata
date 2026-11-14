package com.prismata

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrismataNsdModuleTest {
  @Test
  fun acceptsAndroidDnsSdServiceTypeVariantsOnlyForPrismata() {
    assertTrue(PrismataNsdModule.isPrismataServiceType("_prismata._tcp"))
    assertTrue(PrismataNsdModule.isPrismataServiceType("_prismata._tcp."))
    assertTrue(PrismataNsdModule.isPrismataServiceType("_prismata._tcp.local"))
    assertTrue(PrismataNsdModule.isPrismataServiceType("_prismata._tcp.local."))
    assertFalse(PrismataNsdModule.isPrismataServiceType("_other._tcp.local."))
    assertFalse(PrismataNsdModule.isPrismataServiceType("_prismata._udp.local."))
    assertFalse(PrismataNsdModule.isPrismataServiceType("_prismata._tcp.example."))
  }
}
