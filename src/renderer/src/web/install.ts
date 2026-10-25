import { createHttpApi } from './httpApi'

// Side-effect module: no rendering imports, so window.api is set before the app renders.
window.api = createHttpApi()
