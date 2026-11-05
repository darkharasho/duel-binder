import Capacitor
import UIKit

/// A stream (src/phone/stream/device.ts): the phone may rotate to landscape and the screen stays on.
/// - `Stream.enter()`: allows every orientation but upside down and disables the idle timer.
/// - `Stream.exit()`: back to portrait only, and the idle timer runs again. The app calls it at start too, so a reloaded page starts upright.
/// - `Stream.shareFile({ name, mime, base64 })`: writes a file (a Rip Replay) to the temporary folder and opens the share sheet, where Save Video is.
@objc(StreamPlugin)
public class StreamPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StreamPlugin"
    public let jsName = "Stream"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise)
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

    @objc func shareFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name"),
              !name.contains("/"),
              let base64 = call.getString("base64"),
              let data = Data(base64Encoded: base64) else {
            call.reject("Not a file to share")
            return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject("Couldn't write the file")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("Nothing to share from")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // An iPad shows the sheet as a popover, which needs somewhere to point.
            sheet.popoverPresentationController?.sourceView = presenter.view
            sheet.popoverPresentationController?.sourceRect = CGRect(
                x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
            sheet.popoverPresentationController?.permittedArrowDirections = []
            sheet.completionWithItemsHandler = { _, _, _, _ in call.resolve() }
            presenter.present(sheet, animated: true)
        }
    }
}
