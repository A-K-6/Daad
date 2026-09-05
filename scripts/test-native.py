#!/usr/bin/env python3
"""Real native TLS/SRTP acceptance. Only an isolated localhost Asterisk.

Run via `bun run test:native`. DAAD_ASTERISK_IMAGE may select an existing
local Asterisk image. Never targets a live PBX or makes PSTN calls.
"""
import json
import math
import os
from pathlib import Path
import platform
import secrets
import shlex
import struct
import subprocess
import sys
import tempfile
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
system = "darwin" if platform.system() == "Darwin" else "linux"
arch = "arm64" if platform.machine() in ("arm64", "aarch64") else "x64"
PREFIX = Path(os.environ.get("DAAD_PJSIP_PREFIX", ROOT / f"src-tauri/target/native/{system}-{arch}/install"))
IMAGE = os.environ.get("DAAD_ASTERISK_IMAGE", "andrius/asterisk:20.8")
NAME = f"daad-native-test-{os.getpid()}"


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)


def cli(command):
    return run(["docker", "exec", NAME, "asterisk", "-rx", command]).stdout


def verify_audio(file):
    with wave.open(str(file), "rb") as audio:
        rate, frames = audio.getframerate(), audio.getnframes()
        assert audio.getsampwidth() == 2 and audio.getnchannels() == 1
        samples = struct.unpack("<" + "h" * frames, audio.readframes(frames))
    rms = math.sqrt(sum(x*x for x in samples) / max(1, len(samples)))
    assert frames > rate * 5 and rms > 1000, f"No sustained returned test tone: seconds={frames/rate:.2f}, rms={rms:.1f}"
    # Verify the generated 997 Hz tone, not merely nonzero noise.
    # Short windows tolerate the intentional silence cadence and playout
    # phase shifts. Require most signal energy to be at the sent frequency.
    tone_energy = total_energy = 0.0
    size = rate // 10
    for start in range(0, len(samples) - size, size):
        window = samples[start:start+size]
        re = sum(x * math.cos(2*math.pi*997*i/rate) for i, x in enumerate(window))
        im = sum(x * math.sin(2*math.pi*997*i/rate) for i, x in enumerate(window))
        tone_energy += 2*(re*re+im*im)/size
        total_energy += sum(x*x for x in window)
    tone_ratio = tone_energy / max(1, total_energy)
    assert tone_ratio > .3, "Returned signal did not contain the transmitted tone"
    return {"seconds": round(frames/rate, 2), "rms": round(rms, 1), "tone_ratio": round(tone_ratio, 3)}


def main():
    report = []
    with tempfile.TemporaryDirectory(prefix="daad-native-acceptance-") as directory:
        work = Path(directory)
        env = dict(os.environ, PKG_CONFIG_PATH=str(PREFIX / "lib/pkgconfig"))
        flags = shlex.split(run(["pkg-config", "--static", "--cflags", "--libs", "libpjproject"], env=env).stdout)
        driver = work / "smoke"
        run(["cc", "-Wall", "-Wextra", "-Werror", str(ROOT / "src-tauri/native/pjsua_adapter.c"),
             str(ROOT / "src-tauri/native/smoke.c"), "-o", str(driver), *flags])
        run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "2", "-nodes",
             "-keyout", str(work/"asterisk.key"), "-out", str(work/"asterisk.crt"),
             "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"])
        (work/"ca.crt").write_bytes((work/"asterisk.crt").read_bytes())
        config = (ROOT/"docker/asterisk/config/pjsip.conf").read_text()
        passwords = {u: secrets.token_hex(20) for u in ("1001", "1002", "1003", "1004")}
        for user, password in passwords.items():
            config = config.replace("${DAAD_TEST_PASSWORD_" + user + "}", password)
        config = config.replace("direct_media = no", "direct_media = no\nmedia_address = 127.0.0.1")
        # The container listens on 5061, but in-dialog requests must use the
        # published host port. Without this, BYE follows an unreachable Contact.
        config = config.replace("bind = 0.0.0.0:5061", "bind = 0.0.0.0:5061\nlocal_net = 127.0.0.1/32\nexternal_signaling_address = 127.0.0.1\nexternal_signaling_port = 15061")
        (work/"pjsip.conf").write_text(config)
        (work/"pjsip.conf").chmod(0o600)
        (work/"extensions.conf").write_bytes((ROOT/"docker/asterisk/config/extensions.conf").read_bytes())
        (work/"rtp.conf").write_text("[general]\nrtpstart=16000\nrtpend=16019\nstrictrtp=no\n")
        (work/"modules.conf").write_text("[modules]\nautoload=yes\n")
        args = ["docker", "run", "-d", "--name", NAME, "--entrypoint", "asterisk",
                "-p", "127.0.0.1:15061:5061/tcp", "-p", "127.0.0.1:16000-16019:16000-16019/udp"]
        for file in ("pjsip.conf", "extensions.conf", "rtp.conf", "modules.conf"):
            args += ["-v", f"{work/file}:/etc/asterisk/{file}:ro"]
        args += ["-v", f"{work}:/etc/asterisk/keys:ro", IMAGE, "-f"]
        started = False
        try:
            run(args)
            started = True
            for _ in range(60):
                try:
                    if "transport-tls" in cli("pjsip show transports"): break
                except subprocess.CalledProcessError: pass
                time.sleep(.5)
            else: raise RuntimeError("Isolated Asterisk did not start")
            if "--serve" in sys.argv:
                # Five-minute fixture for physical-device acceptance in Daad.
                # Credentials are synthetic and live only in this private directory.
                account_file = work / "client-account.json"
                account_file.write_text(json.dumps({"server":"tls://127.0.0.1:15061",
                    "username":"1001", "password":passwords["1001"], "ca":str(work/"ca.crt")}))
                account_file.chmod(0o600)
                print(f"Local echo fixture ready; account: {account_file}; dial 600", flush=True)
                time.sleep(300)
                return
            cli("pjsip set logger on")
            for name in ("outgoing", "incoming", "dtmf", "bad-password", "untrusted-ca"):
                testenv = dict(os.environ, DAAD_TEST_USER="1001", DAAD_TEST_PASSWORD=passwords["1001"])
                testenv.pop("DAAD_TEST_RECEIVE", None)
                testenv.pop("DAAD_TEST_TARGET", None)
                testenv.pop("DAAD_TEST_DTMF", None)
                ca = work/"ca.crt"
                if name == "bad-password": testenv["DAAD_TEST_PASSWORD"] = "wrong-password"
                if name == "untrusted-ca":
                    ca = work/"empty.pem"; ca.write_text("")
                if name == "incoming": testenv["DAAD_TEST_RECEIVE"] = "1"
                if name == "dtmf": testenv["DAAD_TEST_DTMF"] = "1"
                output = work/(name + ".wav")
                with (work/(name + ".log")).open("w+") as log:
                    process = subprocess.Popen([str(driver), str(ca), str(output)], env=testenv, stdout=log, stderr=log)
                    deadline = time.monotonic() + 50
                    originated = False
                    try:
                        while process.poll() is None and time.monotonic() < deadline:
                            log.flush(); log.seek(0); content = log.read()
                            if name == "incoming" and not originated and "kind=1 code=200 state=1" in content:
                                cli("channel originate PJSIP/1001 application Echo"); originated = True
                            time.sleep(.1)
                        if process.poll() is None: raise RuntimeError(f"{name}: native client timed out")
                    finally:
                        if process.poll() is None: process.kill(); process.wait()
                    log.seek(0); content = log.read()
                if name in ("outgoing", "incoming", "dtmf"):
                    assert process.returncode == 0 and "srtp_active=1" in content, f"{name}: call/SRTP failed"
                    assert "kind=1 code=200 state=0" in content, "Unregister was not acknowledged"
                    try:
                        audio = verify_audio(output)
                    except AssertionError:
                        print(content, flush=True)
                        raise
                    if name == "dtmf":
                        assert "dtmf rfc4733_hash_received=1" in content, "Asterisk did not act on keypad digit"
                    report.append({"test":name,"srtp":True,**audio})
                else:
                    assert process.returncode != 0 and "code=200 state=1" not in content, f"{name}: unexpectedly registered"
                    if name == "untrusted-ca":
                        assert "kind=6 " in content, "Missing actionable certificate failure event"
                    report.append({"test":name,"rejected":True})
                # Core processes teardown asynchronously after the client exits.
                for _ in range(50):
                    channels = cli("core show channels count")
                    contacts = cli("pjsip show contacts")
                    if "0 active channels" in channels and "No objects found" in contacts:
                        break
                    time.sleep(.1)
                else:
                    import re
                    logtext = run(["docker", "logs", NAME]).stdout
                    print("\n".join(line for line in logtext.splitlines() if re.match(r"(?:<---|BYE |Contact:|Route:|SIP/2.0 )", line)), flush=True)
                    raise AssertionError(f"Isolated Core cleanup failed: {channels!r}; {contacts!r}")
                print(f"PASS {name}", flush=True)
        finally:
            if started: run(["docker", "rm", "-f", NAME])
    destination = ROOT/"src-tauri/target/native-acceptance.json"
    destination.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Evidence: {destination}")


if __name__ == "__main__":
    main()
