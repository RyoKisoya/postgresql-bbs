'use strict';

const formidable = require('formidable');
const http = require('http');
const server = http.createServer();
const port = process.env.PORT;
const searchtype = 'image';
const minPage = 1;
const onePage = 10;
const maxline = 1000;
const maxlength = 2048;
const pg = require('pg');
const connectionString = process.env.DATABASE_URL;
const fs = require('fs');
const html = require('fs').readFileSync('bbs.html');
const css = require('fs').readFileSync('bbs.css');
const ico = require('fs').readFileSync('favicon.ico');

let rowCount = 0;

if(require.main === module) {
	main();
}

function setCookie(key, val, res) {
	const escapedVal = escape(val);
	res.setHeader('Set-Cookie', [`${key}=${escapedVal}`]);
}

function getCookie(key, req) {
	const cookieData = req.headers.cookie !== undefined ? req.headers.cookie : '';
	const datas = cookieData.split(';').map(data => data.trim());
	const msgKeyVal = datas.find(data => data.startsWith(`${key}=`));
	if(msgKeyVal === undefined) return '';
	const msgVal = msgKeyVal.replace(`${key}=`, '');
	return unescape(msgVal);
}

function autoLink(val) {
	const regUrl = /((h?)(ttps?:\/\/[a-zA-Z0-9.\-_@:/~?%&;=+#',()*!]+))/g; // ']))/;
	const regLnk = function(all, url, h, href) {
		return '<a href="h'+href+'">'+url+'</a>';
	}
	return val.replace(regUrl, regLnk);
}

function main() {
	server.on('request', async function(req, res) {
console.log('req.url:',req.url);
		switch(true) {
		case /favicon\.ico/.test(req.url):
console.log('favicon.ico');
			res.writeHead(200, {'Content-Type': 'image/x-icon'});
			res.write(ico);
			res.end();
			break;
		case /bbs\.css/.test(req.url):
console.log('bbs.css');
			res.writeHead(200, {'Content-Type': 'text/css'});
			res.write(css);
			res.end();
			break;
		default:
			const pool = new pg.Pool({ connectionString: connectionString });
			if(req.method === 'GET') {
console.log('GET');
				let val_fr = minPage;
				let val_to = onePage;
				const postname = getCookie('postname', req);
				res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
				res.write(html);
				res.write(
					'<form method="POST" enctype="multipart/form-data">'+
					//nametext
					'<div class="nametext">'+
					'<input type="text" name="name" value="'+postname+'" />'+
					'</div>'+
					//areatext
					'<div class="areatext">'+
					'<textarea name="value"></textarea>'+
					'</div>'
				);
				//filebtn
				res.write('<input type="file" name="upload" class="filebtn">');
				//sendbtn
				res.write(
					'<div class="sendbtn">'+
					'<input type="submit">'+
					'</div>'+
					'</form>'
				);
				res.write('<hr />');
				//sql
				const cnt_result = await pool.query('select count(id) from bbs;');
				rowCount = cnt_result.rows[0].count;
console.log('rowCount:',rowCount);
				const allPage = rowCount>0 ? Math.ceil(rowCount/onePage) : 1;
				if(req.url ==='/prev') {
					val_to = val_fr-onePage<onePage ? onePage : val_to-onePage;
					val_fr = val_fr-onePage<onePage ? minPage : val_fr-onePage;
				} else if(req.url ==='/next') {
					val_to = val_fr+onePage>rowCount ? val_to : val_to+onePage;
					val_fr = val_fr+onePage>rowCount ? val_fr : val_fr+onePage;
				} else if(String(req.url).replace(/[^0-9]/g, '')) {
					val_to = onePage*String(req.url).replace(/[^0-9]/g, '');
					val_fr = val_to-onePage;
				} else {
					val_fr = minPage;
					val_to = onePage;
				}

console.log('val_fr:',val_fr);
console.log('val_to:',val_to);

				const numPage = val_to/onePage;
console.log(numPage,'/',allPage);
				const sql = "select id, name, value, filename, filetype, encode(filedata,'base64') as filedata, rn "+
					"from (select *, row_number() over (order by id desc) as rn from bbs) t "+
					"where t.rn between $1 and $2;";
				const val = [val_fr, val_to]; 
				const sql_result = await pool.query(sql,val);
				for(const data of sql_result.rows) {
					const id = '['+data.id+']';
					const name = '['+data.name+']';
					const value = autoLink(data.value);
					const filename = data.filename;
					const filetype = data.filetype;
					const filedata = data.filedata;
					let img = '';
					if(filedata) {
						if(filetype.indexOf(searchtype)) {
							img = '<a href="'+'data:'+filetype+';base64,'+
								filedata+'" download="'+filename+'">'+filename+'</a>';
						} else {
							img = '<img src="'+'data:'+filetype+';base64,'+
								filedata+'" title="'+filename+'" style="pointer-events: none;"/>';
						}
					}
					res.write('<div class="names">');
					res.write(name);
					res.write(id);
					res.write('</div>');
					res.write('<div class="values">'+
						value.replace(/\r?\n/g, '<br>')+'</div>');
					res.write('<br>');
					res.write(img);
					res.write('<hr />');
				}

				//footer
				let btnPrev = '';
				let btnNext = '';
				let btnPage = '';

				if(val_fr <= minPage) {
					btnPrev = '<li class="none"><a><span>«</</span></a></li>';
				} else {
					btnPrev = '<li class="prev"><a href="/prev"><span>«</span></a></li>';
				}
				if((val_fr <= rowCount && val_to >= rowCount) || rowCount==0) {
					btnNext = '<li class="none"><a><span>»</span></a></li>';
				} else {
					btnNext = '<li class="next"><a href="/next"><span>»</span></a></li>';
				}

				//PageNo.
				for(let i=1;i<=allPage;i++){
					let iPage = i.toString(10);
					if(i==numPage) {
						btnPage += '<li class="nonum"><a><span>'+iPage+'</span></a></li>';
					} else {
						btnPage += '<li><a href="'+iPage+'"><span>'+iPage+'</span></a></li>';
					}
				}
				
				res.write('<div class="pager">'+
					'<ul class="pagination">'+
					btnPrev+
					btnPage+
					btnNext+
					'</ul>'+
					'</div>');
				const date = new Date();
				res.write(date.toString());
				res.end();
			} else if(req.method === 'POST') {
console.log('POST');
				let form = new formidable.IncomingForm();
				form.uploadDir = "./";
	    		form.parse(req, async function(err, fields, files) {
					let postdata = '';
					postdata = fields.name;
					const postname = postdata.trim();
					postdata = fields.value;
					const postvalue = postdata.trim();
console.log('postname:', postname);
console.log('postvalue:', postvalue);
					//file
					const filesize = files.upload.size;
					postdata = files.upload.name;
					const postuploadname = filesize ? postdata.trim() : '';
					postdata = files.upload.type;
					const postuploadtype = filesize ? postdata.trim() : '';
					postdata = files.upload.path;
					const postuploadpath = postdata.trim();
					const postuploaddata = filesize ? fs.readFileSync(postuploadpath) : '';
console.log('postuploadname:', postuploadname);
console.log('postuploadpath:', postuploadpath);
console.log('postuploadsize:', filesize);
					try {
						fs.statSync(postuploadpath);
						fs.unlinkSync(postuploadpath);
console.log('filedelete:', postuploadpath);
					} catch {
console.log('filedaleteerror');
					}
					if(postname.length && postvalue.length) {
						if(rowCount >= maxline) {
							const del_result = await pool.query('delete from bbs where id in(select min(id) from bbs);');
						}
						const sql_ins  = filesize ?
							'insert into bbs(name, value, filename, filetype, filedata) values($1,$2,$3,$4,$5);' :
							'insert into bbs(name, value) values($1,$2);';
						const sql_val = filesize ?
							[postname.substr(0,maxlength),postvalue.substr(0,maxlength), postuploadname,postuploadtype,postuploaddata] :
							[postname.substr(0,maxlength),postvalue.substr(0,maxlength)];
						const ins_result = await pool.query(sql_ins, sql_val);
						setCookie('postname', postname, res);
					}
					res.writeHead(303, { 'Location': '/' });
					res.end();
				});
			}
			pool.on('drain', pool.end.bind(pool));
			break;
		}
	});
	server.listen(port);
}
