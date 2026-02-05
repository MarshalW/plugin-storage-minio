分析下面目录的代码：

packages/plugins/@marshal/plugin-storage-minio/src/server

分析基本原理是啥

这个项目是个插件，是 nocobase filemanager 框架下的实现，基于 minio storage

nocobase filemanager 相关代码见：

https://github.com/nocobase/nocobase/tree/main/packages/plugins/%40nocobase/plugin-file-manager/src/server


现在我基于下面的 file 类型 collection：

import { defineCollection } from '@nocobase/database';

export default defineCollection({
    origin: '@marshal/plugin-mineru-doc-service',
    name: 'newspaperPageImages',
    title: 'Page images',
    "logging": true,
    "template": "file",
    "view": false,
    "createdBy": true,
    "updatedBy": true,
    "autoGenId": false,
    "storage": "storageDefaultMinio",
    "createdAt": true,
    "updatedAt": true,
    "filterTargetKey": "id",
    fields: [
        {
            "interface": "input",
            "type": "string",
            "name": "title",
            "deletable": false,
            "uiSchema": {
                "type": "string",
                "title": "{{t(\"Title\")}}",
                "x-component": "Input"
            }
        },
        {
            "interface": "input",
            "type": "string",
            "name": "filename",
            "deletable": false,
            "uiSchema": {
                "type": "string",
                "title": "{{t(\"File name\", { ns: \"file-manager\" })}}",
                "x-component": "Input",
                "x-read-pretty": true
            }
        },
        {
            "interface": "input",
            "type": "string",
            "name": "extname",
            "deletable": false,
            "uiSchema": {
                "type": "string",
                "title": "{{t(\"Extension name\", { ns: \"file-manager\" })}}",
                "x-component": "Input",
                "x-read-pretty": true
            }
        },
        {
            "interface": "integer",
            "type": "integer",
            "name": "size",
            "deletable": false,
            "uiSchema": {
                "type": "number",
                "title": "{{t(\"Size\", { ns: \"file-manager\" })}}",
                "x-component": "InputNumber",
                "x-read-pretty": true,
                "x-component-props": {
                    "stringMode": true,
                    "step": "0"
                }
            }
        },
        {
            "interface": "input",
            "type": "string",
            "name": "mimetype",
            "deletable": false,
            "uiSchema": {
                "type": "string",
                "title": "{{t(\"MIME type\", { ns: \"file-manager\" })}}",
                "x-component": "Input",
                "x-read-pretty": true
            }
        },
        {
            "interface": "input",
            "type": "text",
            "name": "path",
            "deletable": false,
            "uiSchema": {
                "type": "string",
                "title": "{{t(\"Path\", { ns: \"file-manager\" })}}",
                "x-component": "TextAreaWithGlobalScope",
                "x-read-pretty": true
            }
        },
        {
            "interface": "url",
            "type": "text",
            "name": "url",
            "deletable": false,
            "uiSchema": {
                "type": "string",
                "title": "{{t(\"URL\")}}",
                "x-component": "Input.URL",
                "x-read-pretty": true
            }
        },
        {
            "interface": "url",
            "type": "text",
            "name": "preview",
            "field": "url",
            "deletable": false,
            "uiSchema": {
                "type": "string",
                "title": "{{t(\"Preview\", { ns: \"file-manager\" })}}",
                "x-component": "Preview",
                "x-read-pretty": true
            }
        },
        {
            "type": "belongsTo",
            "name": "storage",
            "interface": "m2o",
            "target": "storages",
            "foreignKey": "storageId",
            "deletable": false,
            "uiSchema": {
                "type": "object",
                "title": "{{t(\"Storage\", { ns: \"file-manager\" })}}",
                "x-component": "AssociationField",
                "x-component-props": {
                    "fieldNames": {
                        "value": "id",
                        "label": "title"
                    }
                },
                "x-read-pretty": true
            },
            "targetKey": "id"
        },
        {
            "type": "jsonb",
            "name": "meta",
            "deletable": false,
            "defaultValue": {}
        },
        {
            "name": "id",
            "type": "bigInt",
            "interface": "integer",
            "autoIncrement": true,
            "primaryKey": true,
            "allowNull": false,
            "uiSchema": {
                "type": "number",
                "title": "{{t(\"ID\")}}",
                "x-component": "InputNumber",
                "x-read-pretty": true
            }
        },
        {
            "name": "createdAt",
            "interface": "createdAt",
            "type": "date",
            "field": "createdAt",
            "uiSchema": {
                "type": "datetime",
                "title": "{{t(\"Created at\")}}",
                "x-component": "DatePicker",
                "x-component-props": {},
                "x-read-pretty": true
            }
        },
        {
            "name": "createdBy",
            "interface": "createdBy",
            "type": "belongsTo",
            "target": "users",
            "foreignKey": "createdById",
            "uiSchema": {
                "type": "object",
                "title": "{{t(\"Created by\")}}",
                "x-component": "AssociationField",
                "x-component-props": {
                    "fieldNames": {
                        "value": "id",
                        "label": "nickname"
                    }
                },
                "x-read-pretty": true
            },
            "targetKey": "id"
        },
        {
            "type": "date",
            "name": "updatedAt",
            "interface": "updatedAt",
            "field": "updatedAt",
            "uiSchema": {
                "type": "datetime",
                "title": "{{t(\"Last updated at\")}}",
                "x-component": "DatePicker",
                "x-component-props": {},
                "x-read-pretty": true
            }
        },
        {
            "type": "belongsTo",
            "name": "updatedBy",
            "interface": "updatedBy",
            "target": "users",
            "foreignKey": "updatedById",
            "uiSchema": {
                "type": "object",
                "title": "{{t(\"Last updated by\")}}",
                "x-component": "AssociationField",
                "x-component-props": {
                    "fieldNames": {
                        "value": "id",
                        "label": "nickname"
                    }
                },
                "x-read-pretty": true
            },
            "targetKey": "id"
        }
    ]
});


发起请求（nocobase restful api）：


Request URL
http://ant:13000/api/newspaperPageImages:create
Request Method
POST
Status Code
200 OK
Remote Address
192.168.0.75:13000
Referrer Policy
strict-origin-when-cross-origin

accept
application/json, text/plain, */*
accept-encoding
gzip, deflate
accept-language
zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7,ko;q=0.6
authorization
Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInRlbXAiOnRydWUsImlhdCI6MTc3MDIxNTYxNiwic2lnbkluVGltZSI6MTc3MDIxNTYxNjA5NSwiZXhwIjoxNzcwMzAyMDE2LCJqdGkiOiI0OWE3ZTY0MS03YTAxLTQ5ODYtYjFlYy0xMTZhYjMyNjI4ZjcifQ.EtN_bg6AuTSdIPtAsOcTWnz7SzA8txTyyiBU2Vlh2DM
connection
keep-alive
content-length
928953
content-type
multipart/form-data; boundary=----WebKitFormBoundaryLTInmX1PFAqokEVp
cookie
m=59b9:true; token=AENGnKOGGz+NRcUnURvbw4DwHxM9GV2u7oQrjkYTcqpZEwEbiLxTiuNTCL74/Hb6SUrKw1KPYHckiLliJRnr2KIafwnIXey1zG1GXN9js0mzJZdU9y/I6CweW3CNSum3sFBEgvFSIeuNAtJ5NzRjUXK03fPbnubLDq7LHQIQ5r9vitZXhtfhdRIAlzSkUsPKPExAFsJpmp3IJqfQTmoTboaFJ//2BRwlWoUcgapVO0CdoVNniLyL3ldLxc17ULBWdrl3VltrSr9g+pLaP0DXFl3uG1OYLJS9lZKNtmuUDjRZt+ufbzDvuYAf7GotEV6Txnzo75caOcXkkhfFuVysq5vtW9Qp7pJGh8wX48qztTCVXdSnqTDbgyurANgcA9IoSWX8hSW5D16Re4cBddGpAmg9XMwRGFQoNThT/X0ElBpfSqW5E2+ptf1IrzVTpLkUpw1lq1kJR29jdNroRvp5tSybA2jN48eEym9dPe8Ncb3q/ocPxuqQdK9+l5XMrotzgoppv2IidJJoVcxpDn4qeZACldYn7eevCr15b8Vx0Qw=
host
ant:13000
origin
http://ant:13000
referer
http://ant:13000/admin/a40dyxju01r/popups/bhtrifprrzs/collection/newspaperPages
user-agent
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36
x-authenticator
basic
x-hostname
ant
x-locale
en-US
x-role
root
x-timezone
+08:00
x-with-acl-meta
true

-----

保存成功，得到的响应是：

{
    "data": {
        "createdAt": "2026-02-05T11:43:44.862Z",
        "updatedAt": "2026-02-05T11:43:44.865Z",
        "pageId": null,
        "path": "",
        "url": "http://ant:9000/mineru-doc-app/dev/uploads/1770291824693-news-01.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=nm3GCqOVIFSb27tlcycs%2F20260205%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260205T114344Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=13eabb8644638d1a682e99d1216e9ea50fd2839921924de1fbf20ea2064f28c6",
        "title": "news-01",
        "filename": "1770291824693-news-01.jpg",
        "extname": ".jpg",
        "size": null,
        "mimetype": "image/jpeg",
        "preview": "http://ant:9000/mineru-doc-app/dev/uploads/1770291824693-news-01.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=nm3GCqOVIFSb27tlcycs%2F20260205%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260205T114344Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=13eabb8644638d1a682e99d1216e9ea50fd2839921924de1fbf20ea2064f28c6",
        "meta": {},
        "id": 1,
        "storageId": 346055714406400,
        "createdById": 1,
        "updatedById": 1
    }
}

----

基于上面的信息，帮我分析，如果我基于 api，类似这样：

const posts = db.getRepository('posts');

const result = await posts.create({
  values: {
    title: 'NocoBase 1.0 发布日志',
    tags: [
      // 有关系表主键值时为更新该条数据
      { id: 1 },
      // 没有主键值时为创建新数据
      { name: 'NocoBase' },
    ],
  },
});


我怎么将本地文件，设置给 newspaperPageImages

我的理解是：

- 表里能存的只是url
- 需要一个api，能先存储image数据 -- 我这里是上传到 s3/minio
- 但是，file manager 是否提供了统一的api -- 不然我就的使用具体实现的api，以后不灵活-- 比如改为用本地的


怎么做，给出具体思路说明和代码示例，写在 plan/2026-02-05/1-answer.md

注意，不要用 POST /api/{collectionName}:create + multipart/form-data restful api，还需要权限处理，本来就在内部，直接用api方式