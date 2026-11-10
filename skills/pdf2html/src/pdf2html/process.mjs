import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultMaxBuffer = 256 * 1024 * 1024;

async function runQpdf(command, args, options) {
  const { timeout = 120000, maxBuffer = defaultMaxBuffer, encoding = 'utf8', signal, killSignal = 'SIGTERM' } = options;
  if (signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
  if (!Number.isFinite(maxBuffer) || maxBuffer < 0) throw new RangeError('Invalid maxBuffer');
  let directory, stdoutFd, stderrFd, result, failure;
  try {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2html-qpdf-'));
    stdoutFd = fs.openSync(path.join(directory, 'output.json'), 'wx+', 0o600);
    stderrFd = fs.openSync(path.join(directory, 'error.json'), 'wx+', 0o600);
    const child = spawn(command, args, { ...options, timeout: undefined, signal: undefined, stdio: ['ignore', stdoutFd, stderrFd] });
    let stopped, escalation, timeoutTimer, monitor, abortHandler, childError;
    const stop = error => {
      if (stopped) return;
      stopped = error;
      try { child.kill(killSignal); } catch {}
      escalation = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGKILL'); } catch {} }, 1000);
    };
    const checkSize = () => {
      try {
        if (fs.fstatSync(stdoutFd).size > maxBuffer || fs.fstatSync(stderrFd).size > maxBuffer)
          stop(Object.assign(new Error('QPDF output exceeds maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
      } catch (error) { stop(error); }
    };
    const closed = new Promise(resolve => {
      child.once('error', error => { childError = error; });
      child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });
    if (timeout > 0) timeoutTimer = setTimeout(() => stop(Object.assign(new Error('QPDF timed out'), { code: 'ETIMEDOUT', killed: true })), timeout);
    monitor = setInterval(checkSize, 20);
    if (signal) {
      abortHandler = () => stop(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) abortHandler();
    }
    const exit = await closed;
    clearTimeout(timeoutTimer); clearTimeout(escalation); clearInterval(monitor);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
    const sizes = [fs.fstatSync(stdoutFd).size, fs.fstatSync(stderrFd).size];
    if (sizes.some(size => size > maxBuffer)) stopped ||= Object.assign(new Error('QPDF output exceeds maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    const read = (fd, size) => {
      const buffer = Buffer.alloc(size); let offset = 0;
      while (offset < size) { const count = fs.readSync(fd, buffer, offset, size - offset, offset); if (!count) throw new Error('Short QPDF output read'); offset += count; }
      return encoding === 'buffer' || encoding === null ? buffer : buffer.toString(encoding);
    };
    const empty = () => encoding === 'buffer' || encoding === null ? Buffer.alloc(0) : '';
    const stdout = sizes[0] <= maxBuffer ? read(stdoutFd, sizes[0]) : empty();
    const stderr = sizes[1] <= maxBuffer ? read(stderrFd, sizes[1]) : empty();
    const error = stopped || childError || (exit.code !== 0 ? new Error(`QPDF exited with code ${exit.code}`) : null);
    if (error) {
      if (error.code === undefined) error.code = exit.code;
      error.signal = exit.signal; error.stdout = stdout; error.stderr = stderr;
      throw error;
    }
    result = { stdout, stderr };
  } catch (error) { failure = error; }
  finally {
    const errors = [];
    for (const fd of [stdoutFd, stderrFd]) if (fd !== undefined) try { fs.closeSync(fd); } catch (error) { errors.push(error); }
    if (directory) {
      for (const name of ['output.json', 'error.json']) try { fs.unlinkSync(path.join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') errors.push(error); }
      try { fs.rmdirSync(directory); } catch (error) { errors.push(error); }
    }
    if (errors.length) failure = new AggregateError(errors, 'QPDF temporary output cleanup failed', { cause: failure });
  }
  if (failure) throw failure;
  return result;
}

export const run = async (command, args, options = {}) => {
  if (['pdfinfo', 'pdftoppm', 'qpdf'].includes(command)) {
    const local = fileURLToPath(new URL(`../../external/tools/${process.platform}-${process.arch}/bin/${command}`, import.meta.url));
    if (fs.existsSync(local)) command = local;
  }
  const isQpdf = path.basename(command) === 'qpdf';
  try {
    return isQpdf ? await runQpdf(command, args, options) : await promisify(execFile)(command, args, { timeout: 120000, maxBuffer: defaultMaxBuffer, ...options });
  } catch (error) {
    if (isQpdf && error.code === 3 && /operation succeeded with warnings/i.test(String(error.stderr))) {
      return { stdout: error.stdout || '', stderr: error.stderr || '', warning: true };
    }
    throw new Error(`${command}: ${String(error.stderr || error.message).trim()}${error.killed ? ' (process timed out)' : ''}`, { cause: error });
  }
};
