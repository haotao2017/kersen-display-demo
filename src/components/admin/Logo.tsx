import React from 'react'

export function Logo() {
  return (
    <div className="kd-logo">
      <div className="kd-logo-icon" aria-hidden="true">
        KD
      </div>
      <span className="kd-logo-text">
        <strong>Kersen</strong>
        <small>Display Console</small>
      </span>
    </div>
  )
}

export function Icon() {
  return (
    <div className="kd-logo-icon-sm" aria-hidden="true">
      KD
    </div>
  )
}
