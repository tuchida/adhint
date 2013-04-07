
RHINO = ../rhino1_7R4/js.jar

.PHONY: test
test:
	java -jar $(RHINO) -require -debug test/test.js
