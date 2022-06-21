require('dotenv').config()

const RECRUITEE_API_TOKEN = process.env.RECRUITEE_API_TOKEN
const RECRUITEE_COMPANY_ID = process.env.RECRUITEE_COMPANY_ID
const GOOGLE_CREDENTIALS = require('./google-credentials.json')
const GOOGLE_SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID

const fs = require('fs')
fs.mkdirSync('cache', {recursive: true})

const path = require('path')
const url = require('url')
const axios = require('axios').default
const instance = axios.create({
    baseURL: 'https://api.recruitee.com/',
    // use long timeout if you have a lot of candidates
    timeout: 100000,
    headers: {
        authorization: 'Bearer ' + RECRUITEE_API_TOKEN
    }
})
const { GoogleSpreadsheet } = require('google-spreadsheet');

async function downloadFile(fileUrl, outputLocationPath) {
    console.log('downloading file', fileUrl, outputLocationPath)
    return new Promise((resolve, reject) => {
        return axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
        }).then(response => {
            const writer = fs.createWriteStream(outputLocationPath);

            response.data.pipe(writer);
            let error = null;
            writer.on('error', err => {
                error = err;
                writer.close();
                reject(err);
            });
            writer.on('close', () => {
                if (!error) {
                    resolve(true);
                }
            });
        });
    });
}

async function cacheRequest(url) {
    const cacheFile = [
        '.',
        'cache',
        url.replace(/\//g, '_') + '.json'
    ].join('/')

    if (!fs.existsSync(cacheFile)) {
        const response = await instance.get(url)
        fs.writeFileSync(
            cacheFile,
            JSON.stringify(response.data)
        )
        return response.data
    } else {
        return JSON.parse(fs.readFileSync(cacheFile))
    }
}

async function captureMailbox(emailPath, candidateId) {
    const mailbox = (await cacheRequest([
        'c',
        RECRUITEE_COMPANY_ID,
        'mailbox',
        'candidate',
        candidateId
    ].join('/'))).threads.map((v) => {
        return {
            threadId: v.id,
            messages: v.messages.map((v2) => {
                return {
                    from: v2.from[0].email,
                    to: v2.to[0].email,
                    content: v2.safe_stripped_html
                }
            })
        }
    })

    let count = 0
    for(let thread of mailbox) {
        for(let mailId in thread.messages) {
            let mail = thread.messages[mailId]
            const path = [emailPath, [candidateId, thread.threadId, mailId, mail.from, mail.to].join('_')].join('/')
            fs.writeFileSync(path + '.html', mail.content)
            count++
        }
    }
    return count
}
async function captureNotes(notesPath, candidateId) {
    const notes = (await cacheRequest([
        'c',
        RECRUITEE_COMPANY_ID,
        'candidates',
        candidateId,
        'notes'
    ].join('/'))).notes.map((v) => {
        return {
            noteId: v.id,
            content: v.body_html
        }
    })
    for(let note of notes) {
        const path = [notesPath, [candidateId, note.noteId].join('_')].join('/')
        fs.writeFileSync(path + '.html', note.content)
    }
    return notes.length
}

async function run() {
    const googleDoc = new GoogleSpreadsheet(GOOGLE_SPREADSHEET_ID)
    await googleDoc.useServiceAccountAuth(GOOGLE_CREDENTIALS)
    await googleDoc.loadInfo(); // loads document properties and worksheets
    let targetSheet = googleDoc.sheetsByTitle['Candidates']
    let targetRows = await targetSheet.getRows()
    const candidatesList = await cacheRequest('/c/' + RECRUITEE_COMPANY_ID + '/candidates')

    for(let candidate of candidatesList.candidates) {
        console.log('crawling candidate', candidate.id)

        let emailsPath = ['.', 'candidates', [candidate.id, candidate.name].join('_'), 'emails'].join('/')
        let notesPath = ['.', 'candidates', [candidate.id, candidate.name].join('_'), 'notes'].join('/')
        fs.mkdirSync(emailsPath, {recursive: true})
        fs.mkdirSync(notesPath, {recursive: true})

        const candidateDetails = await cacheRequest('/c/' + RECRUITEE_COMPANY_ID + '/candidates/' + candidate.id)
        let cvFileName = ['cv', path.basename(url.parse(candidateDetails.candidate.cv_original_url).pathname).split('.').pop()].join('.')
        let cvFilePath = ['.', 'candidates', [candidate.id, candidate.name].join('_'), cvFileName].join('/')

        if(!fs.existsSync(cvFilePath)) {
            await downloadFile(candidateDetails.candidate.cv_original_url, cvFilePath)
        }
        const mailCount = await captureMailbox(emailsPath, candidate.id)
        const noteCount = await captureNotes(notesPath, candidate.id)

        const stages = candidateDetails.candidate.placements.map((v) => {
            return candidateDetails.references.filter((ref) => ref.id == v.stage_id).pop().name
        })
        let job = 'unknown / n/a'
        if(candidateDetails.references.length>0) {
            let offerItems = candidateDetails.references.filter((ref) => ref.type === 'Offer')
            if(offerItems.length > 0) {
                job = offerItems.pop().title
            } else {
                console.error('failed to find job in references for candidate', candidate.id, candidateDetails.references)
            }
        }

        const updateValue = {
            candidate_id: candidate.id,
            created_at: candidateDetails.candidate.created_at,
            last_activity_at: candidateDetails.candidate.last_activity_at,
            job: job,
            name: candidateDetails.candidate.name,
            emails: candidateDetails.candidate.emails.join(', '),
            phones: '\'' + candidateDetails.candidate.phones.join(', '),
            referrer: candidateDetails.candidate.referrer,
            gdpr_status: candidateDetails.candidate.gdpr_status,
            stages: stages.join(', '),
            cv_path: cvFilePath,
            emails_count: mailCount,
            email_path: emailsPath,
            notes_count: noteCount,
            notes_path: notesPath
        }
        const candidateSpreadsheetRow = targetRows.filter((v) => v.candidate_id == candidate.id).pop()
        if(candidateSpreadsheetRow) {
            console.log('updating existing spreadsheet row')
            for(let key of Object.keys(updateValue)) {
                candidateSpreadsheetRow[key] = updateValue[key]
            }
            //await candidateSpreadsheetRow.save()
        } else {
            console.log('adding new candidate row to spreadsheet')
            await targetSheet.addRow(updateValue)
        }

    }
}
run()