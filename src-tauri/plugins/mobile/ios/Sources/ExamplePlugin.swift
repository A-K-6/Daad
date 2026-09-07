import Tauri
import UIKit
import AVFoundation

private struct UrlArgs: Decodable { let url: String }

class MobilePlugin: Plugin {
    @objc public func prepareAudio(_ invoke: Invoke) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            invoke.resolve(["granted": granted])
        }
    }
    @objc public func openUrl(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(UrlArgs.self)
        guard let url = URL(string: args.url), ["https", "http"].contains(url.scheme ?? "") else {
            invoke.reject("Only web links can be opened")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url) { success in
                if success { invoke.resolve() }
                else { invoke.reject("Could not open the system browser") }
            }
        }
    }
}

@_cdecl("init_plugin_mobile")
func initPlugin() -> Plugin { MobilePlugin() }
