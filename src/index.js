const puppeteer = require('puppeteer')
const fs = require('fs')
const axios = require('axios')
const unzipper = require('unzipper')
const exec = require('child_process').exec

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
    // await page.screenshot({
    //   path: `screenshots/${Date.now()}.png`,
    //   fullPage: true,
    // })
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

    let match = await new Promise((res) => {
      Promise.all(
        names.map((repo) =>
          fetchRepo(repo).then(() => {
            console.log('search', repo)
            return search(code, `cache/${repo}/`).then((v) => {
              if (v) res(repo)
            })
          })
        )
      ).then(res)
    })

    if (typeof match !== 'string') {
      console.error('no match found')
      match = names[0]
    }

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

function search(phrase, dir) {
  return new Promise((res) => {
    try {
      // let toId
      const p = exec(
        `grep '${phrase.replace(/'/g, "\\'")}' -R ${dir}`,
        (err, v) => {
          p.kill()
          // clearTimeout(toId)
          if (v) res(true)
          else res(false)
        }
      )
      // toId = setTimeout(() => {
      //   p.kill()
      //   console.warn(`${dir} timed out`)
      //   res(false)
      // }, 5000)
    } catch (e) {
      res(false)
    }
  })
}

module.exports = { search }
