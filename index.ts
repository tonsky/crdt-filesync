import * as am from "@automerge/automerge/next"
import * as fs from "fs-extra"
import * as path from "path"

type DocType = {text: string}

let client = process.argv[2]
let pathState = `data/${client}/state`
let pathOps = `data/${client}/ops`
let doc
let debug = true

if (fs.existsSync(pathState)) {
  doc = am.load(new Uint8Array(fs.readFileSync(pathState)))
} else {
  fs.mkdirsSync(`data/${client}`)
  doc = am.init<DocType>()
}

function saveChanges() {
  let change = am.getLastLocalChange(doc)
  const changeLen = change.length
  const changeLenBuf = Buffer.alloc(4)
  changeLenBuf.writeUInt32BE(changeLen)
  if (debug) console.log(`/// Appending to data/${client}/ops`)
  fs.writeFileSync(pathOps, Buffer.concat([changeLenBuf, Buffer.from(change)]), {flag: 'a', flush: true})
}

function saveDoc() {
  if (debug) console.log(`/// Writing data/${client}/state`)
  fs.writeFileSync(pathState, am.save(doc), {flush: true})
}

function printDoc() {
  console.log(client, ">", doc.text)
}

function insertText(idx, text) {
  doc = am.change(doc, (d) => {
    if (!d.text)
      d.text = ""
    am.splice(d, ["text"], idx, 0, text)
  })
  saveChanges()
  saveDoc()
  printDoc()
}

function deleteText(from, to) {
  doc = am.change(doc, d => {
    am.splice(d, ["text"], from, to - from)
  })
  saveChanges()
  saveDoc()
  printDoc()
}

function pullDoc(remote) {
  const fd = fs.openSync(`data/${remote}/ops`, 'r')
  let bytesRead = 0;
  let changes = []
  while (true) {
    const changeLenBuf = Buffer.alloc(4);
    if (0 === fs.readSync(fd, changeLenBuf, 0, 4, bytesRead)) {
      break
    }

    const changeLen = changeLenBuf.readUInt32BE(0);
    const change = Buffer.alloc(changeLen);
    if (0 === fs.readSync(fd, change, 0, changeLen, bytesRead + 4)) {
      break
    }
    bytesRead += 4 + changeLen;

    changes.push(change)
  }
  doc = am.applyChanges(doc, changes)[0]
  saveDoc()
  printDoc()
}

function onNewOp(client) {
  console.log(`Merging < ${client}`)
  pullDoc(client)
}

function onNewClient(client) {
  console.log(`New peer: ${client}`)
  fs.watch(`data/${client}`, (event, filename) => {
    if ("ops" === filename) {
      onNewOp(client)
      fs.watchFile(`data/${client}/ops`, (curr, prev) => {
        if (debug) console.log(`/// Updated: data/${client}/ops`)
        onNewOp(client)
      })
    }
  })
}

fs.readdirSync("data").forEach(file => {
  if (client !== file && fs.statSync(`data/${file}`).isDirectory()) {
    onNewOp(file)
    fs.watchFile(`data/${file}/ops`, (curr, prev) => {
      if (debug) console.log(`/// Updated: data/${file}/ops`)
      onNewOp(file)
    })
  }
})

fs.watch("data", (event, file) => {
  if (client !== file && fs.statSync(`data/${file}`).isDirectory()) {
    onNewClient(file)
  }
})

printDoc()
process.stdin.setEncoding('utf8');
process.stdin.on('data', (input) => {
  let command = input.replace(/[\n\r]+$/, '').split(" ")

  if ('exit' === command[0]) {
    process.exit(0);
  } else if ("print" === command[0]) {
    printDoc()
  } else if ("insert" === command[0]) {
    let idx = parseInt(command[1])
    let text = command.slice(2).join(' ')
    insertText(idx, text)
  } else if ("delete" === command[0]) {
    let from = parseInt(command[1])
    let to = parseInt(command[2])
    deleteText(from, to)
  } else {
    console.log("Unknown command:", command[0])
  }
});

