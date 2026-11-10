# Dependencies

The task helper requires Node.js 22 or later. Remote processing, package verification and publication guards require Linux with `/proc/self/fd` and `/usr/bin/flock` from util-linux. The ordinary RoboTeam runtime provides these tools. The helper uses directory file descriptors to keep task paths confined while files are transferred and merged, and holds a file lock across each processing command. It fails closed when these prerequisites are unavailable. No native ScriptaHub processing dependencies are required in RoboTeam.
