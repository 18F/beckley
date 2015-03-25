# Re-recreate the ES service.
cf create-service elasticsearch free beckley-es

# Recreate the test loader, api and service binding.
cf push
