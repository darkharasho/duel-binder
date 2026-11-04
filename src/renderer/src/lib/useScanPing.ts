import { useState } from 'react'
import { playScanPing, scanPingOn, setScanPingOn } from './scanPing'

/**
 * The scan ping's on/off, as Settings' ScanPingToggle keeps it (on this device). Turning it on
 * plays the ping, so it can be judged, and a phone's audio is started by this tap.
 */
export function useScanPingSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(scanPingOn)
  return [
    on,
    (next) => {
      setScanPingOn(next)
      setOn(next)
      playScanPing()
    }
  ]
}
