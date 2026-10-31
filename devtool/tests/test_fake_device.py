"""Runs the protocol client against the simulator: python -m pytest tests"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from PIL import Image  # noqa: E402

from inktag_devtool import imaging, protocol  # noqa: E402
from inktag_devtool.fake_device import FakeLink, FakeTag  # noqa: E402


def run(coro_fn, **tag_opts):
    async def go():
        tag = FakeTag()
        shown = []
        tag.on_display = shown.append
        for k, v in tag_opts.items():
            setattr(tag, k, v)
        link = FakeLink(tag)
        await link.connect()
        client = protocol.TagClient(link)
        try:
            return await coro_fn(client, tag, shown)
        finally:
            await link.close()
    return asyncio.run(go())


def make_frame():
    img = Image.radial_gradient("L").convert("RGB").resize((600, 400))
    p = imaging.prepare(img)
    frame = imaging.pack(p)
    assert len(frame) == imaging.FRAME_BYTES
    # Decoding the frame gives back the preview exactly.
    assert imaging.frame_to_image(frame).tobytes() == imaging.preview(p).tobytes()
    return frame


def test_frame():
    make_frame()


def test_upload_and_info():
    frame = make_frame()

    async def go(client, tag, shown):
        info = await client.info()
        assert info["has_image"] is False and info["temp_override"] == protocol.TEMP_UNKNOWN
        sent = []
        secs, temp = await client.upload(frame, lambda s, t: sent.append(s))
        assert sent[-1] == len(frame) and shown[-1] == frame and tag.stored == frame
        assert (await client.info())["has_image"]
        await client.show()
        assert len(shown) == 2
    run(go)


def test_crc_error_and_retry():
    frame = make_frame()

    async def go(client, tag, shown):
        tag.corrupt_next_upload = True
        try:
            await client.upload(frame)
            raise AssertionError("expected CRC error")
        except protocol.TagError as e:
            assert e.code == 5
        await client.upload(frame)
    run(go)


def test_show_without_image_and_clear():
    async def go(client, tag, shown):
        try:
            await client.show()
            raise AssertionError("expected no image")
        except protocol.TagError as e:
            assert e.code == 8
        await client.clear(imaging.COLOR_CODES["red"])
        assert shown[-1] == bytes([0x33]) * imaging.FRAME_BYTES
    run(go)


def test_temp_override():
    async def go(client, tag, shown):
        info = await client.set_temp_override(5)
        assert info["temp_override"] == 5
        assert await client.clear(1) == 5
        info = await client.set_temp_override(None)
        assert info["temp_override"] == protocol.TEMP_UNKNOWN
    run(go)


def test_old_firmware_rejects_temp():
    async def go(client, tag, shown):
        info = await client.info()
        assert info["temp_override"] is None and info["firmware"] == "0.1.0"
        try:
            await client.set_temp_override(20)
            raise AssertionError("expected bad command")
        except protocol.TagError as e:
            assert e.code == protocol.ERR_BAD_COMMAND
    run(go, support_temp_cmd=False)


def test_cancel_sends_abort():
    frame = make_frame()

    async def go(client, tag, shown):
        task = asyncio.create_task(client.upload(frame))
        await asyncio.sleep(0.9)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0.1)
        assert not tag._receiving and tag.stored is None
    run(go)


def test_panel_id():
    async def go(client, tag, shown):
        info = await client.info()
        assert info["panel_id"] == tag.panel_id and protocol.panel_answering(info["panel_id"])
        tag.panel_id = b"\xff\xff\xff"
        assert protocol.panel_answering((await client.info())["panel_id"]) is False
    run(go)
