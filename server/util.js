'use strict';

const crypto = require('crypto');

const SECRET = 'paylab_sandbox_secret_2026';
let counter = 0;

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function stamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function rid(prefix, date = new Date()) {
  counter = (counter + 1) % 100000;
  return `${prefix}${stamp(date)}${pad(counter, 3)}${pad(Math.floor(Math.random() * 10000), 4)}`;
}

function toCents(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const normalized = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(normalized)) return NaN;
  return Math.round(normalized * 100);
}

function yuan(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function fmtCents(cents) {
  return yuan(cents).toFixed(2);
}

function fmtMoney(cents) {
  return yuan(cents).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + days);
  return dateStr(d);
}

function isoAfter(date, ms) {
  return new Date(date.getTime() + ms).toISOString();
}

function signString(obj) {
  return Object.keys(obj)
    .filter((key) => key !== 'sign' && obj[key] !== undefined && obj[key] !== null)
    .sort()
    .map((key) => `${key}=${typeof obj[key] === 'object' ? JSON.stringify(obj[key]) : obj[key]}`)
    .join('&');
}

function sign(obj) {
  return crypto.createHmac('sha256', SECRET).update(signString(obj)).digest('hex');
}

function signed(obj) {
  return { ...obj, sign: sign(obj) };
}

function verifySignature(obj) {
  if (!obj || typeof obj.sign !== 'string') return false;
  return obj.sign === sign(obj);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function roundFee(amount, rate) {
  if (!rate) return 0;
  return Math.max(1, Math.round(amount * rate));
}

function hash(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

module.exports = {
  SECRET,
  rid,
  pad,
  stamp,
  toCents,
  yuan,
  fmtCents,
  fmtMoney,
  dateStr,
  addDays,
  isoAfter,
  signString,
  sign,
  signed,
  verifySignature,
  httpError,
  roundFee,
  hash
};
