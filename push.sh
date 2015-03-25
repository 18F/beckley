# Create the ES service.
cf create-service elasticsearch free beckley-example-es

# Prepare the config.
cp config-sample.js config.js

# Push.
cf push beckley-example