create table bbs
(id   timestamp default CURRENT_TIMESTAMP,
name  text      not null,
value text      not null,
filename text,
filetype text,
filedata bytea,     
primary key (id));
