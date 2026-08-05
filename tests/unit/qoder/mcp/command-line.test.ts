import { parseCommand, splitCommandString } from '@/qoder/mcp/command-line';

describe('splitCommandString', () => {
  it('splits simple command', () => {
    expect(splitCommandString('node server.js')).toEqual(['node', 'server.js']);
  });

  it('handles single word', () => {
    expect(splitCommandString('qoder')).toEqual(['qoder']);
  });

  it('handles empty string', () => {
    expect(splitCommandString('')).toEqual([]);
  });

  it('handles whitespace-only string', () => {
    expect(splitCommandString('   ')).toEqual([]);
  });

  it('handles double-quoted arguments', () => {
    expect(splitCommandString('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('handles single-quoted arguments', () => {
    expect(splitCommandString("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('handles multiple quoted arguments', () => {
    expect(splitCommandString('cmd "arg one" "arg two"')).toEqual(['cmd', 'arg one', 'arg two']);
  });

  it('handles mixed quoted and unquoted arguments', () => {
    expect(splitCommandString('cmd --flag "quoted arg" plain')).toEqual(['cmd', '--flag', 'quoted arg', 'plain']);
  });

  it('handles multiple spaces between arguments', () => {
    expect(splitCommandString('cmd   arg1    arg2')).toEqual(['cmd', 'arg1', 'arg2']);
  });

  it('handles leading and trailing whitespace', () => {
    expect(splitCommandString('  cmd arg  ')).toEqual(['cmd', 'arg']);
  });

  it('handles tab characters as whitespace', () => {
    expect(splitCommandString('cmd\targ1\targ2')).toEqual(['cmd', 'arg1', 'arg2']);
  });

  it('preserves spaces inside quotes', () => {
    expect(splitCommandString('"path with spaces/bin" --arg')).toEqual(['path with spaces/bin', '--arg']);
  });

  it('handles adjacent quoted and unquoted content', () => {
    // Quotes are stripped, so "foo"bar becomes foobar
    expect(splitCommandString('"foo"bar')).toEqual(['foobar']);
  });
});

describe('parseCommand', () => {
  it('parses command with no arguments', () => {
    expect(parseCommand('qoder')).toEqual({ cmd: 'qoder', args: [] });
  });

  it('parses command with arguments', () => {
    expect(parseCommand('node server.js --port 3000')).toEqual({
      cmd: 'node',
      args: ['server.js', '--port', '3000'],
    });
  });

  it('uses providedArgs when given', () => {
    expect(parseCommand('node', ['--version'])).toEqual({
      cmd: 'node',
      args: ['--version'],
    });
  });

  it('ignores command string parsing when providedArgs is non-empty', () => {
    expect(parseCommand('node server.js', ['--help'])).toEqual({
      cmd: 'node server.js',
      args: ['--help'],
    });
  });

  it('falls back to parsing when providedArgs is empty array', () => {
    expect(parseCommand('node server.js', [])).toEqual({
      cmd: 'node',
      args: ['server.js'],
    });
  });

  it('handles empty command string', () => {
    expect(parseCommand('')).toEqual({ cmd: '', args: [] });
  });

  it('handles quoted arguments in command string', () => {
    expect(parseCommand('echo "hello world" --verbose')).toEqual({
      cmd: 'echo',
      args: ['hello world', '--verbose'],
    });
  });
});
