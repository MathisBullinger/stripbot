const puppeteer = require('puppeteer')
const fs = require('fs')
const axios = require('axios')
const unzipper = require('unzipper')
const exec = require('child_process').exec
const path = require('path')

process.env = {
  ...process.env,
  ...Object.fromEntries(
    fs
      .readFileSync('./.env', 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((v) => v.split('='))
  ),
}
;(async () => {
  const browser = await puppeteer.launch({ headless: false })
  const page = await browser.newPage()

  await page.goto('https://stripcode.dev/ranked')

  await Promise.race([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.waitForTimeout(1000),
  ])

  // signin
  await page.type('#login_field', process.env.EMAIL)
  await page.type('#password', process.env.PASSWORD)
  await page.waitForTimeout(500)
  await page.click("input[type='submit']")

  await page.waitForSelector('.token.keyword')
  await playRound()

  async function playRound() {
    await page.screenshot({
      path: `screenshots/${Date.now()}.png`,
      fullPage: true,
    })
    const answerBts = await page.$$('.mb-4 > button')

    const names = await Promise.all(
      answerBts.map((v) =>
        page.evaluate((e) => e.querySelector('span').textContent, v)
      )
    )
    let code = await page.evaluate(
      (n) => n.textContent.trim(),
      await page.$('code')
    )
    code = code.split('\n')[0]
    console.log(`\nsearch for "${code}"\n`)

    const match = await new Promise((res) => {
      Promise.all(
        names.map((repo) =>
          fetchRepo(repo)
            .then(() => {
              search(code, `cache/${repo}/`)
            })
            .then((v) => {
              if (v) res(repo)
            })
        )
      )
    })

    if (typeof match !== 'string') throw Error('not found')

    console.log('found in', match)
    await answerBts[names.indexOf(match)].click()
    await page.waitForSelector("button[phx-click='nextQuestion']")
    await (await page.$("button[phx-click='nextQuestion']")).click()
    await playRound()
  }

  await browser.close()
})()

async function fetchRepo(name, branch = 'master') {
  const path = `cache/${name}`
  if (fs.existsSync(path)) return
  try {
    const url = `https://github.com/${name}/archive/${branch}.zip`
    console.log('download', url)
    const { data } = await axios.get(url, {
      responseType: 'stream',
    })
    if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true })
    const s = data.pipe(unzipper.Extract({ path }))
    await new Promise((res) => s.on('finish', res))
  } catch (e) {
    await fetchRepo(name, await defaultBranch(name))
  }
}

async function defaultBranch(name) {
  const {
    data: { default_branch },
  } = await axios.get(`https://api.github.com/repos/${name}`, {
    responseType: 'json',
  })
  if (!default_branch) throw Error(`no default branch found for ${name}`)
  console.log(`found default branch ${default_branch} for ${name}`)
  return default_branch
}

const ignoreFiles = /\.(md|json|yml|lock|png|jpeg|jpg|svg|gif|snap)$/
const ignoreDirs = [
  'config',
  '.github',
  '.circleci',
  '.vscode',
  'packages',
  'assets',
  'resources',
  'test',
  'bin',
  'build',
  '__tests__',
  'docs',
  'demo',
  'style',
]

async function search(phrase, dir) {
  for (const file of fs.readdirSync(dir)) {
    const stat = fs.lstatSync(dir + file)
    if (stat.isDirectory()) {
      if (
        !ignoreDirs.includes(file) &&
        (await search(phrase, `${dir}${file}/`))
      )
        return true
    } else {
      if (ignoreFiles.test(file)) continue
      try {
        // await new Promise((res) =>
        //   exec(
        //     `node ${path.join(__dirname, 'read.js')} ${dir + file}`,
        //     { timeout: 150 },
        //     (err, out) => {
        //       if (err) console.warn(err)
        //       else if (out.includes(phrase)) return true
        //       res()
        //     }
        //   )
        //     .on('exit', res)
        //     .on('disconnect', res)
        //     .on('close', res)
        // )
        const content = fs.readFileSync(dir + file, 'utf-8')
        if (content.includes(phrase)) return true
      } catch (e) {
        console.warn(`couldn't read ${file}`)
        console.error(e)
      }
    }
  }
  return false
}

module.exports = { search }
