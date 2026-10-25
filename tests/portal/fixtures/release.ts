const base = 'https://github.com/darkharasho/duel-binder/releases/download/v0.2.1'
const asset = (name: string, size: number) => ({ name, size, browser_download_url: `${base}/${name}` })

export const releaseV021 = {
  tag_name: 'v0.2.1',
  assets: [
    asset('latest-linux.yml', 560),
    asset('latest-mac.yml', 1020),
    asset('latest.yml', 540),
    asset('yugioh-collection-tracker-0.2.1-setup.exe', 137045557),
    asset('yugioh-collection-tracker-0.2.1-setup.exe.blockmap', 143210),
    asset('yugioh-collection-tracker-0.2.1-universal-mac.zip', 248120331),
    asset('yugioh-collection-tracker-0.2.1-universal-mac.zip.blockmap', 261842),
    asset('yugioh-collection-tracker-0.2.1.AppImage', 146881414),
    asset('yugioh-collection-tracker-0.2.1.dmg', 252235523),
    asset('yugioh-collection-tracker-0.2.1.dmg.blockmap', 266104),
  ],
}
