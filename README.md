# Recruitee Candidates Backup Tool

This tool downloads all candidates, CVs, emails and notes for all
candidates from your Recruitee.com account. 

Features:
- Emails and notes are stored locally as HTML file
- Uploaded CVs by candidates are downloaded locally
- A Google Spreadsheet is synchronised with high level candidate informations
- All requestes are cached and stored as .json file in `cache/`, you can basically rerun everything without querying the Recruitee API which might become valuable if you cancel your Recruitee account and missing data which would be still available in this way

The purpose of this tool is to create backups and easier migration
to other ATS systems since Recruitee doesn't offer any download of data except via their API.

Example:
```shell
RECRUITEE_API_TOKEN=abcd \
RECRUITEE_COMPANY_ID=12345 \
GOOGLE_SPREADSHEET_ID=<spreadsheet id, see Google Spreadsheet Url> \
node app.js
```
