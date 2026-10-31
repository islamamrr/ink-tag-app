"""Bluetooth link to a real badge, using bleak (WinRT on Windows)."""

from bleak import BleakClient, BleakScanner

from . import protocol as p
from .imaging import inktag

UUID_SERVICE, UUID_CONTROL, UUID_DATA = inktag.UUID_SERVICE, inktag.UUID_CONTROL, inktag.UUID_DATA


async def scan(timeout=5.0, show_all=False):
    """Returns [(name, address, rssi, is_inktag)], Ink Tags first."""
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    out = []
    for dev, adv in found.values():
        name = adv.local_name or dev.name or ""
        is_tag = (UUID_SERVICE in [u.lower() for u in adv.service_uuids]
                  or name.startswith("InkTag"))
        if is_tag or (show_all and name):
            out.append((name or dev.address, dev.address, adv.rssi, is_tag))
    out.sort(key=lambda d: (not d[3], -d[2]))
    return out


class BleLink(p.Link):
    def __init__(self, address):
        self.address = address
        self.client = BleakClient(address, disconnected_callback=self._disconnected)

    def _disconnected(self, _client):
        if self.on_disconnect:
            self.on_disconnect()

    async def connect(self):
        await self.client.connect(timeout=15.0)
        # On Windows the MTU is negotiated by the OS; bleak reports the result.
        self.mtu = self.client.mtu_size
        await self.client.start_notify(UUID_CONTROL, lambda _c, d: self.on_notify and self.on_notify(bytes(d)))

    async def write_control(self, data):
        await self.client.write_gatt_char(UUID_CONTROL, data, response=True)

    async def write_data(self, data, response):
        await self.client.write_gatt_char(UUID_DATA, data, response=response)

    async def close(self):
        if self.client.is_connected:
            await self.client.disconnect()
