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

  await page.waitForSelector('code > span.token')
  await playRound()

  async function playRound() {
    await page.waitForSelector('code > span.token')
    const answerBts = await page.$$('.mb-4 > button')

    const names = await Promise.all(
      answerBts.map((v) =>
        page.evaluate((e) => e.querySelector('span').textContent, v)
      )
    )
    let code = await page.evaluate((n) => n.textContent, await page.$('code'))

    let match

    let lines = code
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.replace(/[\s{}()\[\]]/g, '').length -
          a.replace(/[\s{}()\[\]]/g, '').length
      )

    for (let code of lines) {
      console.log(`\nsearch for [${lines.indexOf(code)}] "${code}"`)

      match = await new Promise((res) => {
        Promise.all(
          names.map((repo) =>
            fetchRepo(repo).then(() => {
              console.log('search', repo)
              return search(code, `cache/${repo}/`).then((v) => {
                if (v) res(repo)
              })
            })
          )
        ).then(() => setTimeout(res))
      })
      if (typeof match === 'string') break
    }

    if (typeof match !== 'string') {
      console.error('no match found')
      match = names[0]
    } else console.log('found in', match)

    const s = `.mb-4:nth-child(${names.indexOf(match) + 2}) > button`
    await page.waitForSelector(s)
    await page.click(s)

    while (true) {
      try {
        await page.waitForSelector("button[phx-click='nextQuestion']", {
          timeout: 2000,
        })
        await page.click("button[phx-click='nextQuestion']")
        break
      } catch (e) {
        logger.warn("couldn't submit")
        await page.waitForTimeout(500)
      }
    }
    await page.waitFor(() => !document.querySelector('.bg-green-100'))
    await playRound()
  }
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

let active = []

function search(phrase, dir) {
  return new Promise((res) => {
    try {
      let toId
      const p = exec(
        `ag "${phrase.replace(/"/g, '${dq}')}" ${dir} --nomultiline -Q -t`,
        (err, v) => {
          if (v) {
            active.forEach((f) => f())
            active = []
            res(true)
          } else res(false)
        }
      )
      toId = setTimeout(() => {
        p.kill()
        console.warn(`${dir} timed out`)
        res(true)
      }, 15000)
      active.push(() => {
        clearTimeout(toId)
        p.kill()
      })
    } catch (e) {
      res(false)
    }
  })
}
