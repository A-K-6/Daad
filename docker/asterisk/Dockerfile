# Daad — isolated Asterisk fixture (TEST ONLY, no prod creds)
FROM andrius/asterisk:20.8

# Copy deterministic JBM-contract configs
COPY config/pjsip.conf /etc/asterisk/pjsip.conf
COPY config/extensions.conf /etc/asterisk/extensions.conf
COPY config/rtp.conf /etc/asterisk/rtp.conf
COPY config/logger.conf /etc/asterisk/logger.conf

# Certs are generated at compose/first-run time (see scripts/gen-certs.sh)
# and mounted at /etc/asterisk/keys — never baked into the image.
EXPOSE 5060/tcp 5060/udp 5061/tcp 10000-10199/udp
CMD ["asterisk", "-f", "-U", "asterisk", "-G", "asterisk", "-vvv"]
