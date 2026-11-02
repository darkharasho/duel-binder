import Capacitor
import UIKit

/// A stream (src/phone/stream/device.ts): the phone may rotate to landscape and the screen stays on.
/// - `Stream.enter()`: allows every orientation but upside down and disables the idle timer.
/// - `Stream.exit()`: back to portrait only, and the idle timer runs again. The app calls it at start too, so a reloaded page starts upright.
@objc(StreamPlugin)
public class StreamPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StreamPlugin"
    public let jsName = "Stream"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exit", returnType: CAPPluginReturnPromise)
    ]

    /// Portrait only and the idle timer running again. Main thread only.
    private func putUpright() {
        MainViewController.allowedOrientations = .portrait
        UIApplication.shared.isIdleTimerDisabled = false
        bridge?.viewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        let scene = bridge?.viewController?.view.window?.windowScene
        scene?.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
    }

    @objc func enter(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            MainViewController.allowedOrientations = .allButUpsideDown
            UIApplication.shared.isIdleTimerDisabled = true
            self.bridge?.viewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            call.resolve()
        }
    }

    @objc func exit(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.putUpright()
            call.resolve()
        }
    }
}
