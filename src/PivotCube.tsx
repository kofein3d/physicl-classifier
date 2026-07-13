import React, { useState, useEffect, useRef } from 'react'

type FacePos = { face: string; x: string; y: string; half?: 'top' | 'bottom' | 'left' | 'right' | 'cornerTR' | 'cornerTL' | 'cornerBR' | 'cornerBL' }

const halfStyles: Record<string, React.CSSProperties> = {
  top:      { height: 10, borderRadius: '10px 10px 0 0', transform: 'translate(-50%, -100%)' },
  bottom:   { height: 10, borderRadius: '0 0 10px 10px', transform: 'translate(-50%, 0%)'    },
  left:     { width:  10, borderRadius: '0 10px 10px 0', transform: 'translate(0%, -50%)'    },
  right:    { width:  10, borderRadius: '10px 0 0 10px', transform: 'translate(-100%, -50%)' },
  cornerTR: { width: 10, height: 10, borderRadius: '0 10px 0 0', transform: 'translate(0%, -100%)'    },
  cornerTL: { width: 10, height: 10, borderRadius: '10px 0 0 0', transform: 'translate(-100%, -100%)' },
  cornerBR: { width: 10, height: 10, borderRadius: '0 0 10px 0', transform: 'translate(0%, 0%)'       },
  cornerBL: { width: 10, height: 10, borderRadius: '0 0 0 10px', transform: 'translate(-100%, 0%)'    },
}

const pivotCodeMap: Record<string, FacePos[]> = {
  'A':   [{ face: 'front',  x: '50%', y: '50%'  }],
  'C1':  [{ face: 'bottom', x: '0%',   y: '100%', half: 'cornerTR' }, { face: 'front',  x: '0%',   y: '100%', half: 'cornerTR' }, { face: 'left',  x: '100%', y: '100%', half: 'cornerTL' }],
  'C2':  [{ face: 'bottom', x: '100%', y: '100%', half: 'cornerTL' }, { face: 'front',  x: '100%', y: '100%', half: 'cornerTL' }, { face: 'right', x: '0%',   y: '100%', half: 'cornerTR' }],
  'C3':  [{ face: 'bottom', x: '100%', y: '0%',   half: 'cornerBL' }, { face: 'back',   x: '0%',   y: '100%', half: 'cornerTR' }, { face: 'right', x: '100%', y: '100%', half: 'cornerTL' }],
  'C4':  [{ face: 'bottom', x: '0%',   y: '0%',   half: 'cornerBR' }, { face: 'back',   x: '100%', y: '100%', half: 'cornerTL' }, { face: 'left',  x: '0%',   y: '100%', half: 'cornerTR' }],
  'C5':  [{ face: 'top',    x: '0%',   y: '100%', half: 'cornerTR' }, { face: 'front',  x: '0%',   y: '0%',   half: 'cornerBR' }, { face: 'left',  x: '100%', y: '0%',   half: 'cornerBL' }],
  'C6':  [{ face: 'top',    x: '100%', y: '100%', half: 'cornerTL' }, { face: 'front',  x: '100%', y: '0%',   half: 'cornerBL' }, { face: 'right', x: '0%',   y: '0%',   half: 'cornerBR' }],
  'C7':  [{ face: 'top',    x: '100%', y: '0%',   half: 'cornerBL' }, { face: 'back',   x: '0%',   y: '0%',   half: 'cornerBR' }, { face: 'right', x: '100%', y: '0%',   half: 'cornerBL' }],
  'C8':  [{ face: 'top',    x: '0%',   y: '0%',   half: 'cornerBR' }, { face: 'back',   x: '100%', y: '0%',   half: 'cornerBL' }, { face: 'left',  x: '0%',   y: '0%',   half: 'cornerBR' }],
  'E1':  [{ face: 'bottom', x: '50%', y: '100%', half: 'top'    }, { face: 'front',  x: '50%', y: '100%', half: 'top'    }],
  'E2':  [{ face: 'bottom', x: '100%', y: '50%' }],
  'E3':  [{ face: 'bottom', x: '50%', y: '0%',   half: 'bottom' }, { face: 'back',   x: '50%', y: '100%', half: 'top'    }],
  'E4':  [{ face: 'bottom', x: '0%', y: '50%' }],
  'E5':  [{ face: 'front',  x: '0%',   y: '50%', half: 'left'  }, { face: 'left',   x: '100%', y: '50%', half: 'right' }],
  'E6':  [{ face: 'front',  x: '100%', y: '50%', half: 'right' }, { face: 'right',  x: '0%',   y: '50%', half: 'left'  }],
  'E7':  [{ face: 'back',   x: '0%',   y: '50%', half: 'left'  }, { face: 'right',  x: '100%', y: '50%', half: 'right' }],
  'E8':  [{ face: 'back',   x: '100%', y: '50%', half: 'right' }, { face: 'left',   x: '0%',   y: '50%', half: 'left'  }],
  'E9':  [{ face: 'front',  x: '50%',  y: '0%'  }],
  'E10': [{ face: 'right',  x: '50%',  y: '0%'  }],
  'E11': [{ face: 'top',    x: '50%', y: '0%',   half: 'bottom' }, { face: 'back',   x: '50%', y: '0%',   half: 'bottom' }],
  'E12': [{ face: 'left',   x: '50%', y: '0%' }],
  'S1':  [{ face: 'bottom', x: '50%', y: '50%'  }],
  'S2':  [{ face: 'front',  x: '50%', y: '50%'  }],
  'S3':  [{ face: 'right',  x: '50%', y: '50%'  }],
  'S4':  [{ face: 'back',   x: '50%', y: '50%'  }],
  'S5':  [{ face: 'left',   x: '50%', y: '50%'  }],
  'S6':  [{ face: 'top',    x: '50%', y: '50%'  }],
  'M':   [{ face: 'front', x: '50%', y: '50%' }, { face: 'back', x: '50%', y: '50%' }, { face: 'right', x: '50%', y: '50%' }, { face: 'left', x: '50%', y: '50%' }, { face: 'top', x: '50%', y: '50%' }, { face: 'bottom', x: '50%', y: '50%' }],
}

const FACE_NORMALS: Record<string, [number, number, number]> = {
  front:  [0,  0,  1],
  back:   [0,  0, -1],
  right:  [1,  0,  0],
  left:   [-1, 0,  0],
  top:    [0, -1,  0],
  bottom: [0,  1,  0],
}

function getFaceBlur(face: string, rxDeg: number, ryDeg: number, maxBlur = 2.0): number {
  const rx = (rxDeg * Math.PI) / 180
  const ry = (ryDeg * Math.PI) / 180
  const [nx, ny, nz] = FACE_NORMALS[face] ?? [0, 0, 1]
  const ny1 = ny * Math.cos(rx) - nz * Math.sin(rx)
  const nz1 = ny * Math.sin(rx) + nz * Math.cos(rx)
  const nz2 = -nx * Math.sin(ry) + nz1 * Math.cos(ry)
  return Math.max(0, -nz2) * maxBlur
}

const parsePivotPositions = (pivot: string): FacePos[] => {
  if (!pivot || pivot === 'A' || pivot === 'null') return []
  if (pivotCodeMap[pivot]) return pivotCodeMap[pivot]
  const codeMatch = pivot.match(/\b(C|E|S|A)\d*\b/)
  if (codeMatch && pivotCodeMap[codeMatch[0]]) return pivotCodeMap[codeMatch[0]]
  return [{ face: 'bottom', x: '50%', y: '50%' }]
}

export const PivotCube = ({ pivot, isDark, searchText }: { pivot: string; isDark: boolean; searchText?: string }) => {
  const positions = parsePivotPositions(pivot)
  const faces = [
    { name: 'front',  label: 'Front'  },
    { name: 'back',   label: 'Back'   },
    { name: 'top',    label: 'Top'    },
    { name: 'bottom', label: 'Bottom' },
    { name: 'left',   label: 'Left'   },
    { name: 'right',  label: 'Right'  },
  ]

  const [rotation, setRotation] = useState({ x: -22, y: -28 })
  const [isReturning, setIsReturning] = useState(false)
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - lastPos.current.x
      const dy = e.clientY - lastPos.current.y
      lastPos.current = { x: e.clientX, y: e.clientY }
      setRotation(prev => ({
        x: Math.max(-85, Math.min(0, prev.x - dy * 0.5)),
        y: prev.y + dx * 0.5,
      }))
    }
    const onMouseUp = () => {
      dragging.current = false
      setIsReturning(true)
      setRotation({ x: -22, y: -28 })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true
    setIsReturning(false)
    lastPos.current = { x: e.clientX, y: e.clientY }
  }

  return (
    <div className="flex flex-col items-center mt-10">
      <div className="cube-container" data-dark={String(isDark)} onMouseDown={onMouseDown}>
        <div
          className="cube"
          style={{
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
            transition: isReturning ? 'transform 0.6s ease' : 'none',
          }}
        >
          {faces.map(({ name, label }) => (
            <div
              key={name}
              className={`cube-face ${name}`}
              style={{ filter: `blur(${getFaceBlur(name, rotation.x, rotation.y).toFixed(2)}px)` }}
            >
              {label}
              {positions.filter(p => p.face === name).map((p, i) => (
                <div
                  key={i}
                  className="pivot-point"
                  style={{ left: p.x, top: p.y, ...(p.half ? halfStyles[p.half] : { borderRadius: '50%' }) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={`mt-4 h-9 w-full rounded-lg flex items-center justify-center px-3 text-base font-normal truncate ${isDark ? 'bg-[#404040] text-gray-200' : 'bg-gray-100 text-gray-700'}`}>
        {searchText}
      </div>
    </div>
  )
}
