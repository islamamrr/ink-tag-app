# Draws booster.svg / booster.png: python3 draw_schematic.py booster.svg  (needs: pip install schemdraw matplotlib)
import sys
import schemdraw
import schemdraw.elements as elm
out = sys.argv[1]
if out.endswith('.png'):
    schemdraw.use('matplotlib')
schemdraw.config(fontsize=11)

with schemdraw.Drawing(file=out, show=False) as d:
    d.config(unit=2.5)
    elm.Dot(open=True).at((0, 0)).label('VCC_EPD 3.3 V\n(J1 pins 15, 16)', loc='left')
    elm.Line().right(1.5)
    a = d.here
    elm.Dot()
    elm.Capacitor().down().label('C9\n4.7µF\n16V', loc='bottom', ofst=(0.3, 0))
    elm.Ground()
    elm.Line().at(a).right(0.5)
    elm.Inductor2().right(4.5).label('L1 22µH, ≥0.5 A', loc='top')
    sw = d.here
    elm.Dot().label('SW', loc='top')
    # switch FET, drain up at SW
    elm.Line().at(sw).down(1.2)
    q1 = elm.NFet(anchor='drain').right().reverse().label('Q1\nSi1308EDL', loc='right', ofst=(0.2, 0))
    elm.Line().at(q1.source).down(0.7)
    elm.Dot().label('RESE (J1 pin 3)', loc='right')
    elm.Resistor().down().label('R2\n1.1 Ω', loc='bottom', ofst=(0.3, 0))
    elm.Ground()
    elm.Line().at(q1.gate).left(1.2)
    g = d.here
    elm.Dot().label('GDR\n(J1 pin 2)', loc='left')
    elm.Resistor().down(3).label('R1\n10 kΩ', loc='bottom', ofst=(0.3, 0))
    elm.Ground()

    # positive pump: D3 -> VGH
    elm.Line().at(sw).right(4)
    sw2 = d.here
    elm.Dot()
    elm.Schottky().right(3).label('D3 MBR0530', loc='top')
    vgh = d.here
    elm.Dot().label('VGH (J1 pin 21)', loc='right')
    elm.Capacitor().down().label('C3\n1µF\n25V', loc='bottom', ofst=(0.3, 0))
    elm.Ground()

    # negative pump: C1, D1 -> VGL, D2 -> GND
    elm.Line().at(sw2).up(2.5)
    elm.Capacitor().right(3).label('C1 1µF 25V', loc='top')
    x = d.here
    elm.Dot()
    elm.Schottky().at(x).right(3).reverse().label('D1 MBR0530', loc='top')
    elm.Dot().label('VGL (J1 pin 23)', loc='right')
    vgl = d.here
    elm.Capacitor().up().label('C2\n1µF\n25V', loc='top', ofst=(0.3, 0))
    elm.Line().up(0.3)
    elm.Vss().label('GND', loc='right')
    elm.Schottky().at(x).up(2).label('D2 MBR0530', loc='left')
    elm.Vss().label('GND', loc='right')
